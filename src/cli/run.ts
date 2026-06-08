import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveStatePath } from "../auth/store.js";
import path from "node:path";
import fg from "fast-glob";
import chalk from "chalk";
import ora from "ora";
import {
  loadConfig,
  missingDeclaredEnvVars,
  missingLlmApiKey,
  resolveSensitiveEnvVars,
} from "../config/load.js";
import {
  ensureAuthProfiles,
  resolveConsumerAuthState,
} from "../auth/resolve.js";
import {
  clear as clearAuthStore,
  getAuthScenarioNames,
  list as listAuthStore,
  resolveProfilePath,
} from "../auth/store.js";
import { runScenario } from "../agent/runner.js";
import {
  closeAllBrowserSessions,
  closeBrowserSession,
  prepareBrowserSession,
} from "../agent/bash.js";
import {
  discoverSkills,
  requireSkills,
  resolveSkills,
  verifySkillsLock,
  catalog,
  getSkill,
} from "../skills/loader.js";
import { verifyLockDrift } from "../skills/registry.js";
import {
  parseScenarioFile,
  matchesTags,
  isRunnableScenario,
} from "../scenarios/parser.js";
import { resolveRunGlobs } from "../scenarios/globs.js";
import { applyArtifactsPolicy } from "../artifacts/policy.js";
import type { ArtifactsMode, RunOptions } from "../types/config.js";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import type { ScenarioResult } from "../types/verdict.js";
import {
  alignScenarioResults,
  emptyTranscript,
  mapWithConcurrency,
} from "./concurrency.js";
import {
  classifyFailure,
  isHealingEnabled,
  isScenarioRetryAllowed,
} from "../healing/classify.js";
import { spawnScenarioWorker } from "./subprocess.js";
import {
  buildReport,
  createRunId,
  ensureRunDir,
  scenarioArtifactDir,
  writeReport,
  writeScenarioTranscript,
} from "../reporter/index.js";
import {
  createEnvRedactor,
  type EnvRedactor,
} from "../redact/env-secrets.js";

function safeScenarioName(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

function isScenarioFailure(result: ScenarioResult): boolean {
  return result.status === "fail" || result.status === "error";
}

function logRunSummary(report: {
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
  };
}): void {
  if (report.results.length === 0) {
    return;
  }
  console.log("\nRun summary:");
  for (const result of report.results) {
    const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
    if (result.status === "pass") {
      console.log(chalk.green(`  ✓ ${result.scenario} — pass (${duration})`));
    } else if (result.status === "skipped") {
      console.log(chalk.yellow(`  − ${result.scenario} — skipped`));
      if (result.error) {
        console.log(chalk.yellow(`    ${result.error}`));
      }
    } else {
      console.log(chalk.red(`  ✗ ${result.scenario} — ${result.status} (${duration})`));
      if (result.error) {
        console.log(chalk.red(`    ${result.error}`));
      }
    }
  }
  const { passed, total, failed, errors, skipped } = report.summary;
  const parts = [`${passed}/${total} passed`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (errors > 0) parts.push(`${errors} errors`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  const summaryLine = parts.join(", ");
  console.log(
    failed > 0 || errors > 0 ? chalk.red(summaryLine) : chalk.green(summaryLine),
  );
}

interface ScenarioRunContext {
  config: PqaConfig;
  allSkills: Skill[];
  baseSkillNames: string[];
  cwd: string;
  runDir: string;
  headed: boolean;
  retries: number;
  verbose?: boolean;
  isolatedSessions: boolean;
  keepBrowser: boolean;
  artifacts: ArtifactsMode;
  authStateByProfile: Map<string, string>;
  redactor: EnvRedactor;
  noHealing?: boolean;
  retriesPolicy?: "transient" | "always";
}

function resolveScenarioSessionName(
  config: PqaConfig,
  scenarioName: string,
  isolatedSessions: boolean,
): string {
  if (isolatedSessions) {
    return `${config.browser.sessionName}-${safeScenarioName(scenarioName)}`;
  }
  return config.browser.sessionName;
}

function writeScenarioResult(
  artifactDir: string,
  result: ScenarioResult,
  redactor: EnvRedactor,
): void {
  const safe = redactor.redactScenarioResult(result);
  writeFileSync(
    path.join(artifactDir, "result.json"),
    `${JSON.stringify(safe, null, 2)}\n`,
  );
}

function buildAuthStateMap(
  config: PqaConfig,
  cwd: string,
  profiles: Iterable<string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    map.set(profile, resolveStatePath(cwd, profile, config));
  }
  return map;
}

async function runOneScenario(
  scenario: Scenario,
  ctx: ScenarioRunContext,
  hooks?: {
    onRetry?: (attempt: number) => void;
    onTurn?: () => Promise<void>;
  },
): Promise<ScenarioResult> {
  const name = scenario.frontmatter.name;
  const artifactDir = scenarioArtifactDir(ctx.runDir, name);
  const startedAt = Date.now();

  try {
    const authState = resolveConsumerAuthState(
      ctx.config,
      scenario.frontmatter.auth,
      ctx.cwd,
      ctx.authStateByProfile,
    );
    const authProfile = scenario.frontmatter.auth;
    const profilePath = authProfile
      ? resolveProfilePath(ctx.cwd, authProfile)
      : undefined;
    const sessionName = resolveScenarioSessionName(
      ctx.config,
      name,
      ctx.isolatedSessions,
    );

    const closeSession = async (): Promise<void> => {
      if (ctx.keepBrowser) return;
      await closeBrowserSession({
        cwd: ctx.cwd,
        timeoutMs: ctx.config.agent.bashTimeoutMs,
        sessionName,
        headed: ctx.headed,
        verbose: ctx.verbose,
      });
    };

    const skills = resolveSkills(ctx.allSkills, ctx.baseSkillNames, scenario.skills);

    let result: ScenarioResult | null = null;
    let attempt = 0;
    let scenarioRetries = 0;
    const retriesPolicy =
      ctx.noHealing || !isHealingEnabled(ctx.config, ctx.noHealing)
        ? "always"
        : (ctx.retriesPolicy ?? "transient");

    while (attempt <= ctx.retries) {
      try {
        let preparedStartUrl: string | undefined;
        if (profilePath) {
          ({ startUrl: preparedStartUrl } = await prepareBrowserSession({
            cwd: ctx.cwd,
            timeoutMs: ctx.config.agent.bashTimeoutMs,
            sessionName,
            headed: ctx.headed,
            profilePath,
            startUrl: scenario.frontmatter.url,
            verbose: ctx.verbose,
          }));
        }

        result = await runScenario({
          config: ctx.config,
          skills,
          scenario,
          cwd: ctx.cwd,
          artifactDir,
          authStatePath: authState,
          profilePath,
          headed: ctx.headed,
          verbose: ctx.verbose,
          artifacts: ctx.artifacts,
          sessionName,
          preparedStartUrl,
          onTurn: hooks?.onTurn,
          redactor: ctx.redactor,
          noHealing: ctx.noHealing,
        });

        if (result.healing) {
          result.healing.scenarioRetries = scenarioRetries;
        } else {
          result.healing = {
            used: false,
            recoveryTurns: 0,
            scenarioRetries,
          };
        }

        if (result.status === "pass" || attempt >= ctx.retries) break;

        const classified = classifyFailure(result, scenario, ctx.config);
        if (!isScenarioRetryAllowed(classified, retriesPolicy, ctx.config, ctx.noHealing)) {
          break;
        }

        attempt += 1;
        scenarioRetries += 1;
        hooks?.onRetry?.(attempt);
      } finally {
        await closeSession();
      }
    }

    if (result?.healing) {
      result.healing.scenarioRetries = scenarioRetries;
    }

    applyArtifactsPolicy(artifactDir, ctx.artifacts, result!);
    writeScenarioTranscript(artifactDir, result!, ctx.redactor);
    return result!;
  } catch (err) {
    const error = String(err);
    const errorResult: ScenarioResult = {
      scenario: name,
      filePath: scenario.filePath,
      status: "error",
      durationMs: Date.now() - startedAt,
      verdict: null,
      transcript: emptyTranscript(),
      error: ctx.redactor.redact(error),
      artifactDir,
    };
    applyArtifactsPolicy(artifactDir, ctx.artifacts, errorResult);
    writeScenarioTranscript(artifactDir, errorResult, ctx.redactor);
    return errorResult;
  }
}

export async function executeRun(
  patterns: string[],
  options: RunOptions,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);

  try {
    verifySkillsLock(cwd);
    const drift = verifyLockDrift(cwd);
    if (drift) console.warn(chalk.yellow(`Warning: ${drift}`));
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }

  const apiKeyError = missingLlmApiKey(config);
  if (apiKeyError) {
    console.error(chalk.red(apiKeyError));
    return 2;
  }

  const envVarError = missingDeclaredEnvVars(config);
  if (envVarError) {
    console.error(chalk.red(envVarError));
    return 2;
  }

  const redactor = createEnvRedactor(
    process.env,
    resolveSensitiveEnvVars(config),
  );

  const skillDirs = options.skillsDirs ?? config.skills.dirs;
  const allSkills = discoverSkills(skillDirs, cwd);
  const baseSkillNames = config.skills.preloads;
  requireSkills(allSkills, baseSkillNames);

  const { discoveryGlob, runGlobs } = resolveRunGlobs(config, patterns, cwd);
  const runFiles = new Set(
    await fg(runGlobs, { cwd, absolute: true }),
  );
  if (runFiles.size === 0) {
    console.error(chalk.red("No scenario files matched"));
    return 2;
  }

  const allScenarios = (await fg([discoveryGlob], { cwd, absolute: true }))
    .map(parseScenarioFile);
  const authScenarioNames = getAuthScenarioNames(config);
  const scenarios = allScenarios
    .filter((s) => runFiles.has(s.filePath))
    .filter((s) => isRunnableScenario(s))
    .filter((s) => matchesTags(s, options.tags))
    .filter((s) => !authScenarioNames.has(s.frontmatter.name));

  if (scenarios.length === 0) {
    console.error(chalk.red("No runnable scenarios matched the given patterns and filters"));
    return 2;
  }

  if (options.pause && options.parallel !== undefined) {
    console.error(
      chalk.red("--pause and --parallel cannot be used together"),
    );
    return 2;
  }

  const runId = createRunId();
  const runDir = ensureRunDir(cwd, runId);
  const headed = options.headed ?? config.browser.headed;
  const startedAt = new Date();
  const retries = options.retries ?? 0;
  const parallel = options.parallel;
  const failFast = options.failFast ?? false;
  const artifacts = options.artifacts ?? "on-failure";

  const requiredProfiles = [
    ...new Set(
      scenarios
        .map((s) => s.frontmatter.auth)
        .filter((profile): profile is string => Boolean(profile)),
    ),
  ];

  let authStateByProfile = new Map<string, string>();
  if (requiredProfiles.length > 0) {
    const authSpinner = ora("Ensuring auth profiles").start();
    try {
      authStateByProfile = await ensureAuthProfiles(
        {
          config,
          allSkills,
          baseSkillNames,
          cwd,
          runDir,
          headed,
          verbose: options.verbose,
          allScenarios,
          authRefresh: options.authRefresh,
          keepBrowser: options.keepBrowser ?? false,
          artifacts,
          redactor,
        },
        requiredProfiles,
      );
      authSpinner.succeed(
        `Auth ready: ${requiredProfiles.join(", ")}`,
      );
      await closeAllBrowserSessions({
        cwd,
        timeoutMs: config.agent.bashTimeoutMs,
        headed,
        verbose: options.verbose,
      });
    } catch (err) {
      authSpinner.fail(String(err));
      return 2;
    }
  }

  const scenarioCtx: ScenarioRunContext = {
    config,
    allSkills,
    baseSkillNames,
    cwd,
    runDir,
    headed,
    retries,
    verbose: options.verbose,
    isolatedSessions: parallel !== undefined,
    keepBrowser: options.keepBrowser ?? false,
    artifacts,
    authStateByProfile,
    redactor,
    noHealing: options.noHealing,
    retriesPolicy: options.retriesPolicy,
  };

  console.log(chalk.bold(`PQA run ${runId}`));
  console.log(`Scenarios: ${scenarios.length}`);
  if (parallel !== undefined) {
    const limitLabel = Number.isFinite(parallel)
      ? `max ${parallel}`
      : "unlimited";
    console.log(`Parallel: ${limitLabel}`);
  }
  console.log();

  let results: ScenarioResult[];

  if (parallel !== undefined) {
    const workerOptions: Omit<RunOptions, "parallel" | "pause" | "failFast"> = {
      configPath: options.configPath,
      tags: options.tags,
      skillsDirs: options.skillsDirs,
      verbose: options.verbose,
      retries,
      artifacts,
      headed,
      authRefresh: options.authRefresh,
      keepBrowser: options.keepBrowser,
      noHealing: options.noHealing,
      retriesPolicy: options.retriesPolicy,
    };

    const partial = await mapWithConcurrency(
      scenarios,
      parallel,
      async (scenario) => {
        const name = scenario.frontmatter.name;
        console.log(`[${name}] running...`);
        const result = await spawnScenarioWorker({
          scenarioFilePath: scenario.filePath,
          scenarioName: name,
          runDir,
          cwd,
          options: workerOptions,
        });
        if (result.status === "pass") {
          console.log(chalk.green(`[${name}] passed`));
        } else {
          console.log(chalk.red(`[${name}] ${result.status}`));
          if (result.error) console.error(chalk.red(`[${name}] ${result.error}`));
        }
        return result;
      },
      {
        failFast,
        isFailure: isScenarioFailure,
      },
    );
    results = alignScenarioResults(scenarios, partial);
  } else {
    results = [];
    for (const scenario of scenarios) {
      const spinner = ora(`Running ${scenario.frontmatter.name}`).start();
      const result = await runOneScenario(scenario, scenarioCtx, {
        onRetry: (attempt) => {
          spinner.text = `Retry ${attempt}/${retries} ${scenario.frontmatter.name}`;
        },
        onTurn: options.pause
          ? async () => {
              spinner.stop();
              await new Promise<void>((resolve) => {
                process.stdin.once("data", () => resolve());
              });
              spinner.start();
            }
          : undefined,
      });

      if (result.status === "pass") {
        spinner.succeed(chalk.green(`${scenario.frontmatter.name} passed`));
      } else {
        spinner.fail(
          chalk.red(`${scenario.frontmatter.name} ${result.status}`),
        );
        if (result.error) console.error(chalk.red(result.error));
      }
      results.push(result);

      if (failFast && isScenarioFailure(result)) {
        break;
      }
    }
    if (failFast && results.length < scenarios.length) {
      results = alignScenarioResults(scenarios, results);
    }
  }

  const report = buildReport(runId, startedAt, results);
  writeReport(runDir, report, redactor);

  logRunSummary(report);

  console.log(`\nReport: ${path.join(runDir, "report.html")}`);

  const failed = results.some(
    (r) => r.status === "fail" || r.status === "error",
  );
  return failed ? 1 : 0;
}

export async function executeScenarioWorker(
  scenarioFilePath: string,
  runDir: string,
  options: Omit<RunOptions, "parallel" | "pause" | "failFast">,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);

  const apiKeyError = missingLlmApiKey(config);
  if (apiKeyError) {
    console.error(chalk.red(apiKeyError));
    return 2;
  }

  const envVarError = missingDeclaredEnvVars(config);
  if (envVarError) {
    console.error(chalk.red(envVarError));
    return 2;
  }

  const redactor = createEnvRedactor(
    process.env,
    resolveSensitiveEnvVars(config),
  );

  const skillDirs = options.skillsDirs ?? config.skills.dirs;
  const allSkills = discoverSkills(skillDirs, cwd);
  const baseSkillNames = config.skills.preloads;
  requireSkills(allSkills, baseSkillNames);

  const scenario = parseScenarioFile(scenarioFilePath);
  const authProfile = scenario.frontmatter.auth;
  const authStateByProfile = authProfile
    ? buildAuthStateMap(config, cwd, [authProfile])
    : new Map<string, string>();

  const scenarioCtx: ScenarioRunContext = {
    config,
    allSkills,
    baseSkillNames,
    cwd,
    runDir,
    headed: options.headed ?? config.browser.headed,
    retries: options.retries ?? 0,
    verbose: options.verbose,
    isolatedSessions: true,
    keepBrowser: options.keepBrowser ?? false,
    artifacts: options.artifacts ?? "on-failure",
    authStateByProfile,
    redactor,
    noHealing: options.noHealing,
    retriesPolicy: options.retriesPolicy,
  };

  const result = await runOneScenario(scenario, scenarioCtx);
  const artifactDir =
    result.artifactDir ??
    scenarioArtifactDir(runDir, scenario.frontmatter.name);
  writeScenarioResult(artifactDir, result, redactor);

  return result.status === "pass" ? 0 : 1;
}

export async function executeAuthSave(
  authName: string,
  options: RunOptions,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);

  const apiKeyError = missingLlmApiKey(config);
  if (apiKeyError) {
    console.error(chalk.red(apiKeyError));
    return 2;
  }

  const envVarError = missingDeclaredEnvVars(config);
  if (envVarError) {
    console.error(chalk.red(envVarError));
    return 2;
  }

  verifySkillsLock(cwd);

  const authEntry = config.auth[authName];
  if (!authEntry?.scenario) {
    console.error(
      chalk.red(
        `Auth profile "${authName}" has no scenario in pqa.config.ts. ` +
          `Add auth: { ${authName}: { scenario: "..." } } or pre-seed state manually.`,
      ),
    );
    return 2;
  }

  const skillDirs = options.skillsDirs ?? config.skills.dirs;
  const allSkills = discoverSkills(skillDirs, cwd);
  const baseSkillNames = config.skills.preloads;
  requireSkills(allSkills, baseSkillNames);

  const { discoveryGlob } = resolveRunGlobs(config, [], cwd);
  const files = await fg([discoveryGlob], { cwd, absolute: true });
  const allScenarios = files.map(parseScenarioFile);

  const statePath =
    authEntry.statePath ?? path.join(".pqa", "auth", `${authName}.json`);
  const runDir = ensureRunDir(cwd, createRunId());
  const redactor = createEnvRedactor(
    process.env,
    resolveSensitiveEnvVars(config),
  );
  const spinner = ora(`Saving auth "${authName}"`).start();

  try {
    await ensureAuthProfiles(
      {
        config,
        allSkills,
        baseSkillNames,
        cwd,
        runDir,
        headed: true,
        verbose: options.verbose,
        allScenarios,
        authRefresh: true,
        keepBrowser: options.keepBrowser ?? false,
        artifacts: options.artifacts ?? "never",
        redactor,
      },
      [authName],
    );
  } catch (err) {
    spinner.fail(String(err));
    return 1;
  }

  const updated = { ...config.auth, [authName]: { ...authEntry, statePath } };
  writeFileSync(
    path.resolve(cwd, "pqa.config.auth.json"),
    JSON.stringify({ auth: updated }, null, 2),
  );
  spinner.succeed(`Auth saved to ${statePath}`);
  console.log(
    chalk.dim(
      "Add to pqa.config.ts: auth: { " +
        authName +
        ': { scenario: "' +
        authEntry.scenario +
        '", statePath: "' +
        statePath +
        '" } }',
    ),
  );
  return 0;
}

export function executeAuthList(): number {
  const entries = listAuthStore(process.cwd());
  if (entries.length === 0) {
    console.log(chalk.dim("No auth profiles in store"));
    return 0;
  }

  for (const entry of entries) {
    console.log(
      `${chalk.bold(entry.profile)} — ${entry.scenario ?? "(manual)"} — ${entry.savedAt}`,
    );
    console.log(chalk.dim(`  ${entry.statePath}`));
  }
  return 0;
}

export function executeAuthClear(profile?: string): number {
  clearAuthStore(process.cwd(), profile);
  if (profile) {
    console.log(chalk.green(`Cleared auth profile "${profile}"`));
  } else {
    console.log(chalk.green("Cleared all auth profiles"));
  }
  return 0;
}

export function executeSkillsSync(): number {
  try {
    execSync("tsx scripts/sync-skills.ts", { cwd: process.cwd(), stdio: "inherit" });
    return 0;
  } catch {
    return 1;
  }
}

export function executeSkillsList(skillsDirs: string[]): void {
  const skills = discoverSkills(skillsDirs, process.cwd());
  for (const entry of catalog(skills)) {
    console.log(`${chalk.bold(entry.name)} — ${entry.description}`);
    console.log(chalk.dim(`  ${entry.dir}`));
  }
}

export function executeSkillsShow(name: string, skillsDirs: string[]): number {
  const skills = discoverSkills(skillsDirs, process.cwd());
  const skill = getSkill(skills, name);
  if (!skill) {
    console.error(chalk.red(`Skill not found: ${name}`));
    return 1;
  }
  console.log(`--- ${skill.name} ---\n`);
  console.log(skill.body);
  return 0;
}

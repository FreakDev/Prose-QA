import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import chalk from "chalk";
import ora from "ora";
import {
  loadConfig,
  missingDeclaredEnvVars,
  missingLlmRequirements,
  resolveAgentParallel,
  resolveBrowserHeaded,
  resolveReportConfig,
  resolveSensitiveEnvVars,
} from "../config/load.js";
import {
  getAuthEntry,
  getAuthScenarioNames,
  list as listAuthStore,
  clear as clearAuthStore,
} from "../auth/store.js";
import {
  authScenarioNamesForProfiles,
  buildEnsureAuthContext,
  collectRequiredProfiles,
  toBatchScenarioSummaries,
  toBatchScenarioSummary,
} from "../batch/helpers.js";
import {
  aggregateBatchStatus,
  runPostBatchPhase,
  runPreBatchPhase,
} from "../batch/lifecycle.js";
import { runScenario } from "../agent/runner.js";
import {
  closeAllBrowserSessions,
  closeBrowserSession,
} from "../agent/bash.js";
import {
  discoverSkills,
  requireSkills,
  resolveBaseSkillNames,
  resolveSkills,
  verifyBundledSkill,
  catalog,
  getSkill,
} from "../skills/loader.js";
import {
  findScenarioSummariesByNames,
  parseScenarioFile,
  selectRunnableScenarioSummaries,
  scenarioSummaryToStub,
  tryParseScenarioFrontmatter,
} from "../scenarios/parser.js";
import { resolveRunGlobs } from "../scenarios/globs.js";
import { applyArtifactsPolicy } from "../artifacts/policy.js";
import type { ArtifactsMode, RunOptions } from "../types/config.js";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import type { BatchEntrypoint } from "../types/hooks.js";
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
import { finalizeRunReport, resolveRunDirectory } from "../reporter/export.js";
import { createEnvRedactor, type EnvRedactor } from "../redact/env-secrets.js";
import { generateOrMergeScenarioCacheHints } from "../cache/generate.js";
import { isCacheEnabled } from "../cache/resolve.js";
import { clearCache, loadScenarioCache } from "../cache/store.js";
import { PACKAGE_VERSION } from "../version.js";

function safeScenarioName(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

function isScenarioFailure(result: ScenarioResult): boolean {
  return result.status === "fail" || result.status === "error";
}

function scenarioFailureReason(result: ScenarioResult): string | undefined {
  if (result.status === "fail" && result.verdict?.summary) {
    return result.verdict.summary;
  }
  return result.error;
}

function logScenarioFailureReason(result: ScenarioResult): void {
  const reason = scenarioFailureReason(result);
  if (!reason) return;
  for (const line of reason.split("\n")) {
    console.log(chalk.red(`  ${line}`));
  }
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
      console.log(
        chalk.red(`  ✗ ${result.scenario} — ${result.status} (${duration})`),
      );
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
    failed > 0 || errors > 0
      ? chalk.red(summaryLine)
      : chalk.green(summaryLine),
  );
}

interface ScenarioRunContext {
  config: PqaConfig;
  allSkills: Skill[];
  baseSkillNames: string[];
  allScenarios: Scenario[];
  cwd: string;
  runDir: string;
  headed: boolean;
  retries: number;
  verbose?: boolean;
  isolatedSessions: boolean;
  keepBrowser: boolean;
  artifacts: ArtifactsMode;
  redactor: EnvRedactor;
  noHealing?: boolean;
  retriesPolicy?: "transient" | "always";
  noCache?: boolean;
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


/** Parallel worker subprocess: close browser before exit on interrupt. */
function installScenarioWorkerShutdownHandlers(options: {
  cwd: string;
  config: PqaConfig;
  scenarioName: string;
  headed: boolean;
  keepBrowser: boolean;
  verbose?: boolean;
}): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (!options.keepBrowser) {
      const sessionName = resolveScenarioSessionName(
        options.config,
        options.scenarioName,
        true,
      );
      try {
        await closeBrowserSession({
          cwd: options.cwd,
          timeoutMs: options.config.agent.bashTimeoutMs,
          sessionName,
          headed: options.headed,
          engine: options.config.browser.engine,
          lightpanda: options.config.browser.lightpanda,
          verbose: options.verbose,
        });
      } catch {
        /* best effort */
      }
    }

    process.exit(signal === "SIGINT" ? 130 : 128 + 15);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

async function invokePreBatchPhase(options: {
  config: PqaConfig;
  cwd: string;
  runId: string;
  runDir: string;
  entrypoint: BatchEntrypoint;
  batchScenarios: ReturnType<typeof toBatchScenarioSummaries>;
  requiredProfiles: string[];
  authScenarios: Scenario[];
  allSkills: Skill[];
  baseSkillNames: string[];
  headed: boolean;
  verbose?: boolean;
  authRefresh?: boolean;
  keepBrowser: boolean;
  artifacts: ArtifactsMode;
  redactor: EnvRedactor;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const spinner =
    options.requiredProfiles.length > 0
      ? ora("Ensuring auth profiles").start()
      : undefined;

  const preBatchResult = await runPreBatchPhase({
    config: options.config,
    cwd: options.cwd,
    extensionHooks: options.config.extensions?.hooks,
    runId: options.runId,
    runDir: options.runDir,
    entrypoint: options.entrypoint,
    scenarios: options.batchScenarios,
    requiredProfiles: options.requiredProfiles,
    authRefresh: options.authRefresh,
    verbose: options.verbose,
    ensureAuthContext: buildEnsureAuthContext({
      config: options.config,
      allSkills: options.allSkills,
      baseSkillNames: options.baseSkillNames,
      cwd: options.cwd,
      runDir: options.runDir,
      headed: options.headed,
      verbose: options.verbose,
      allScenarios: options.authScenarios,
      authRefresh: options.authRefresh,
      keepBrowser: options.keepBrowser,
      artifacts: options.artifacts,
      redactor: options.redactor,
    }),
  });

  if (!preBatchResult.ok) {
    spinner?.fail(preBatchResult.error);
    return preBatchResult;
  }

  if (options.requiredProfiles.length > 0) {
    spinner?.succeed(`Auth ready: ${options.requiredProfiles.join(", ")}`);
    await closeAllBrowserSessions({
      cwd: options.cwd,
      timeoutMs: options.config.agent.bashTimeoutMs,
      headed: options.headed,
      engine: options.config.browser.engine,
      lightpanda: options.config.browser.lightpanda,
      verbose: options.verbose,
    });
  }

  return { ok: true };
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
        engine: ctx.config.browser.engine,
        lightpanda: ctx.config.browser.lightpanda,
        verbose: ctx.verbose,
      });
    };

    const skills = resolveSkills(
      ctx.allSkills,
      ctx.baseSkillNames,
      scenario.skills,
    );

    const scenarioCacheHints = isCacheEnabled(ctx.config, ctx.noCache)
      ? loadScenarioCache(ctx.cwd, ctx.config, scenario)
      : undefined;

    let result: ScenarioResult | null = null;
    let attempt = 0;
    let scenarioRetries = 0;
    const retriesPolicy =
      ctx.noHealing || !isHealingEnabled(ctx.config, ctx.noHealing)
        ? "always"
        : (ctx.retriesPolicy ?? "transient");

    while (attempt <= ctx.retries) {
      try {
        result = await runScenario({
          config: ctx.config,
          skills,
          scenario,
          cwd: ctx.cwd,
          artifactDir,
          runDir: ctx.runDir,
          headed: ctx.headed,
          verbose: ctx.verbose,
          artifacts: ctx.artifacts,
          sessionName,
          onTurn: hooks?.onTurn,
          redactor: ctx.redactor,
          noHealing: ctx.noHealing,
          scenarioCacheHints,
          extensionHooks: ctx.config.extensions?.hooks,
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
        if (
          !isScenarioRetryAllowed(
            classified,
            retriesPolicy,
            ctx.config,
            ctx.noHealing,
          )
        ) {
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

    if (result!.status === "pass" && isCacheEnabled(ctx.config, ctx.noCache)) {
      await generateOrMergeScenarioCacheHints(
        ctx.config,
        ctx.cwd,
        scenario,
        result!,
      );
    }

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
    verifyBundledSkill(cwd);
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }

  const llmError = missingLlmRequirements(config);
  if (llmError) {
    console.error(chalk.red(llmError));
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

  const skillDirs = options.skillsDirs ?? config.skills.dirs ?? [];
  const allSkills = discoverSkills(skillDirs, cwd);
  const baseSkillNames = resolveBaseSkillNames(config.skills.preloads);
  requireSkills(allSkills, baseSkillNames);

  const { discoveryGlob, runGlobs } = resolveRunGlobs(config, patterns);
  const runFiles = new Set(await fg(runGlobs, { cwd, absolute: true }));
  if (runFiles.size === 0) {
    console.error(chalk.red("No scenario files matched"));
    return 2;
  }

  // Auth creator scenarios live outside the run pattern — always scan scenariosDir.
  const searchFiles = await fg([discoveryGlob], { cwd, absolute: true });
  const summaries = [...runFiles]
    .map(tryParseScenarioFrontmatter)
    .filter(
      (summary): summary is NonNullable<typeof summary> =>
        summary !== undefined,
    );
  const authScenarioNames = getAuthScenarioNames(config);
  const selectedSummaries = selectRunnableScenarioSummaries(
    summaries,
    options.tags,
    authScenarioNames,
  );

  if (selectedSummaries.length === 0) {
    console.error(
      chalk.red("No runnable scenarios matched the given patterns and filters"),
    );
    return 2;
  }

  const authNamesNeeded = [
    ...new Set(
      selectedSummaries
        .map((s) => s.frontmatter.auth)
        .filter((profile): profile is string => Boolean(profile))
        .map((profile) => getAuthEntry(config, profile)?.scenario)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const authSummaries = findScenarioSummariesByNames(
    searchFiles,
    new Set(authNamesNeeded),
  );
  const authScenarios = authSummaries.map((summary) =>
    parseScenarioFile(summary.filePath),
  );
  const scenarioStubs = selectedSummaries.map(scenarioSummaryToStub);

  const parallel = resolveAgentParallel(config, options.parallel);

  if (options.pause && parallel !== undefined) {
    console.error(chalk.red("--pause and --parallel cannot be used together"));
    return 2;
  }

  const runId = createRunId();
  const reportConfig = resolveReportConfig(config, {
    reportOutputPath: options.reportOutputPath,
    reportZip: options.reportZip,
  });
  const { runDir, zipDestination } = resolveRunDirectory(
    cwd,
    runId,
    reportConfig,
  );
  const headed = resolveBrowserHeaded(config, options.headed);
  const startedAt = new Date();
  const retries = options.retries ?? 0;
  const failFast = options.failFast ?? false;
  const artifacts = options.artifacts ?? "on-failure";

  const requiredProfiles = collectRequiredProfiles(selectedSummaries);
  const batchScenarios = toBatchScenarioSummaries(selectedSummaries);

  if (!options.skipPreBatch) {
    const preBatch = await invokePreBatchPhase({
      config,
      cwd,
      runId,
      runDir,
      entrypoint: "run",
      batchScenarios,
      requiredProfiles,
      authScenarios,
      allSkills,
      baseSkillNames,
      headed,
      verbose: options.verbose,
      authRefresh: options.authRefresh,
      keepBrowser: options.keepBrowser ?? false,
      artifacts,
      redactor,
    });
    if (!preBatch.ok) {
      return 2;
    }
  }

  const scenarioCtx: ScenarioRunContext = {
    config,
    allSkills,
    baseSkillNames,
    allScenarios: authScenarios,
    cwd,
    runDir,
    headed,
    retries,
    verbose: options.verbose,
    isolatedSessions: parallel !== undefined,
    keepBrowser: options.keepBrowser ?? false,
    artifacts,
    redactor,
    noHealing: options.noHealing,
    retriesPolicy: options.retriesPolicy,
    noCache: options.noCache,
  };

  console.log(chalk.bold(`PQA (${PACKAGE_VERSION}) run ${runId}`));
  console.log(
    `Scenarios: ${selectedSummaries.length} – Engine: ${config.browser.engine} – LLM Model: ${config.llm.model} (${config.llm.provider})`,
  );
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
      noCache: options.noCache,
      skipPreBatch: true,
      skipPostBatch: true,
    };

    const partial = await mapWithConcurrency(
      selectedSummaries,
      parallel,
      async (summary) => {
        const name = summary.frontmatter.name;
        console.log(`[${name}] running...`);
        const result = await spawnScenarioWorker({
          scenarioFilePath: summary.filePath,
          scenarioName: name,
          runDir,
          cwd,
          options: workerOptions,
        });
        if (result.status === "pass") {
          console.log(chalk.green(`[${name}] passed`));
        } else {
          console.log(chalk.red(`[${name}] ${result.status}`));
          logScenarioFailureReason(result);
        }
        return result;
      },
      {
        failFast,
        isFailure: isScenarioFailure,
      },
    );
    results = alignScenarioResults(scenarioStubs, partial);
  } else {
    results = [];
    for (const summary of selectedSummaries) {
      const spinner = ora(`Running ${summary.frontmatter.name}`).start();
      let scenario: Scenario;
      try {
        scenario = parseScenarioFile(summary.filePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        spinner.fail(chalk.red(`${summary.frontmatter.name} error`));
        console.error(chalk.red(message));
        results.push({
          scenario: summary.frontmatter.name,
          filePath: summary.filePath,
          status: "error",
          durationMs: 0,
          verdict: null,
          transcript: emptyTranscript(),
          error: message,
        });
        if (failFast) {
          results = alignScenarioResults(scenarioStubs, results);
          break;
        }
        continue;
      }

      const result = await runOneScenario(scenario, scenarioCtx, {
        onRetry: (attempt) => {
          spinner.text = `Retry ${attempt}/${retries} ${summary.frontmatter.name}`;
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
        spinner.succeed(chalk.green(`${summary.frontmatter.name} passed`));
      } else {
        spinner.fail(chalk.red(`${summary.frontmatter.name} ${result.status}`));
        logScenarioFailureReason(result);
      }
      results.push(result);

      if (failFast && isScenarioFailure(result)) {
        break;
      }
    }
    if (failFast && results.length < selectedSummaries.length) {
      results = alignScenarioResults(scenarioStubs, results);
    }
  }

  if (!options.skipPostBatch) {
    const postBatch = await runPostBatchPhase({
      config,
      cwd,
      extensionHooks: config.extensions?.hooks,
      runId,
      runDir,
      entrypoint: "run",
      scenarios: batchScenarios,
      requiredProfiles,
      results,
      status: aggregateBatchStatus(results),
      verbose: options.verbose,
    });
    if (!postBatch.ok) {
      console.error(chalk.red(postBatch.error));
      return 2;
    }
  }

  const report = buildReport(runId, startedAt, results);
  writeReport(runDir, report, redactor);

  logRunSummary(report);

  const reportPath = finalizeRunReport(runDir, zipDestination);
  console.log(`\nReport: ${reportPath}`);

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

  const llmError = missingLlmRequirements(config);
  if (llmError) {
    console.error(chalk.red(llmError));
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

  const skillDirs = options.skillsDirs ?? config.skills.dirs ?? [];
  const allSkills = discoverSkills(skillDirs, cwd);
  const baseSkillNames = resolveBaseSkillNames(config.skills.preloads);
  requireSkills(allSkills, baseSkillNames);

  const scenario = parseScenarioFile(scenarioFilePath);
  const runId = path.basename(runDir);
  const headed = resolveBrowserHeaded(config, options.headed);
  const artifacts = options.artifacts ?? "on-failure";
  const batchScenario = toBatchScenarioSummary(scenario);
  const requiredProfiles = collectRequiredProfiles([scenario]);

  installScenarioWorkerShutdownHandlers({
    cwd,
    config,
    scenarioName: scenario.frontmatter.name,
    headed,
    keepBrowser: options.keepBrowser ?? false,
    verbose: options.verbose,
  });

  let authScenarios: Scenario[] = [];
  if (requiredProfiles.length > 0) {
    const { searchGlobs } = resolveRunGlobs(config, []);
    const searchFiles = await fg(searchGlobs, { cwd, absolute: true });
    const authNamesNeeded = authScenarioNamesForProfiles(
      config,
      requiredProfiles,
    );
    const authSummaries = findScenarioSummariesByNames(
      searchFiles,
      new Set(authNamesNeeded),
    );
    authScenarios = authSummaries.map((summary) =>
      parseScenarioFile(summary.filePath),
    );
  }

  if (!options.skipPreBatch) {
    const preBatch = await invokePreBatchPhase({
      config,
      cwd,
      runId,
      runDir,
      entrypoint: "worker",
      batchScenarios: [batchScenario],
      requiredProfiles,
      authScenarios,
      allSkills,
      baseSkillNames,
      headed,
      verbose: options.verbose,
      authRefresh: options.authRefresh,
      keepBrowser: options.keepBrowser ?? false,
      artifacts,
      redactor,
    });
    if (!preBatch.ok) {
      return 2;
    }
  }

  const scenarioCtx: ScenarioRunContext = {
    config,
    allSkills,
    baseSkillNames,
    allScenarios: authScenarios,
    cwd,
    runDir,
    headed,
    retries: options.retries ?? 0,
    verbose: options.verbose,
    isolatedSessions: true,
    keepBrowser: options.keepBrowser ?? false,
    artifacts,
    redactor,
    noHealing: options.noHealing,
    retriesPolicy: options.retriesPolicy,
    noCache: options.noCache,
  };

  const result = await runOneScenario(scenario, scenarioCtx);
  const artifactDir =
    result.artifactDir ??
    scenarioArtifactDir(runDir, scenario.frontmatter.name);
  writeScenarioResult(artifactDir, result, redactor);

  if (!options.skipPostBatch) {
    const postBatch = await runPostBatchPhase({
      config,
      cwd,
      extensionHooks: config.extensions?.hooks,
      runId,
      runDir,
      entrypoint: "worker",
      scenarios: [batchScenario],
      requiredProfiles,
      results: [result],
      status: aggregateBatchStatus([result]),
      verbose: options.verbose,
    });
    if (!postBatch.ok) {
      console.error(chalk.red(postBatch.error));
      return 2;
    }
  }

  return result.status === "pass" ? 0 : 1;
}

export async function executeClearCache(
  scenarioName?: string,
  configPath?: string,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(configPath, cwd);
  clearCache(cwd, config, scenarioName);
  if (scenarioName) {
    console.log(chalk.green(`Cleared cache for scenario "${scenarioName}"`));
  } else {
    console.log(chalk.green("Cleared all scenario caches"));
  }
  return 0;
}

export function executeSkillsSync(): number {
  try {
    execSync("tsx scripts/sync-skills.ts", {
      cwd: process.cwd(),
      stdio: "inherit",
    });
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

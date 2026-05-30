import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import chalk from "chalk";
import ora from "ora";
import {
  loadConfig,
  missingLlmApiKey,
  resolveAuthState,
} from "../config/load.js";
import { runScenario, runAuthSave } from "../agent/runner.js";
import {
  discoverSkills,
  requireSkills,
  verifySkillsLock,
  catalog,
  getSkill,
} from "../skills/loader.js";
import { verifyLockDrift } from "../skills/registry.js";
import {
  parseScenarioFile,
  matchesTags,
} from "../scenarios/parser.js";
import type { RunOptions } from "../types/config.js";
import type { ScenarioResult } from "../types/verdict.js";
import {
  buildReport,
  createRunId,
  ensureRunDir,
  scenarioArtifactDir,
  writeReport,
  writeScenarioTranscript,
} from "../reporter/index.js";

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

  const skillDirs = options.skillsDirs ?? config.skills.dirs;
  const allSkills = discoverSkills(skillDirs, cwd);
  const activeNames = [
    ...new Set([...config.skills.preloads, ...config.skills.activate]),
  ];
  const skills = requireSkills(allSkills, activeNames);

  const globs = patterns.length > 0 ? patterns : ["scenarios/**/*.md"];
  const files = await fg(globs, { cwd, absolute: true });
  if (files.length === 0) {
    console.error(chalk.red("No scenario files matched"));
    return 2;
  }

  const scenarios = files
    .map(parseScenarioFile)
    .filter((s) => matchesTags(s, options.tags));

  if (scenarios.length === 0) {
    console.error(chalk.red("No scenarios matched tag filter"));
    return 2;
  }

  const runId = createRunId();
  const runDir = ensureRunDir(cwd, runId);
  const baseUrl = options.baseUrl ?? config.baseUrl;
  const headed = options.headed ?? config.browser.headed;
  const startedAt = new Date();
  const results: ScenarioResult[] = [];
  const retries = options.retries ?? 0;

  console.log(chalk.bold(`SAQ run ${runId}`));
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Scenarios: ${scenarios.length}\n`);

  for (const scenario of scenarios) {
    const spinner = ora(`Running ${scenario.frontmatter.name}`).start();
    const artifactDir = scenarioArtifactDir(
      runDir,
      scenario.frontmatter.name,
    );
    const authState = resolveAuthState(
      config,
      scenario.frontmatter.auth,
      cwd,
    );
    const scenarioBaseUrl =
      scenario.frontmatter.baseUrl ?? baseUrl;

    let result: ScenarioResult | null = null;
    let attempt = 0;

    while (attempt <= retries) {
      result = await runScenario({
        config,
        skills,
        scenario,
        cwd,
        baseUrl: scenarioBaseUrl,
        artifactDir,
        authStatePath: authState,
        headed,
        verbose: options.verbose,
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

      if (result.status === "pass" || attempt >= retries) break;
      attempt += 1;
      spinner.text = `Retry ${attempt}/${retries} ${scenario.frontmatter.name}`;
    }

    writeScenarioTranscript(artifactDir, result!);

    if (result!.status === "pass") {
      spinner.succeed(chalk.green(`${scenario.frontmatter.name} passed`));
    } else {
      spinner.fail(
        chalk.red(`${scenario.frontmatter.name} ${result!.status}`),
      );
      if (result!.error) console.error(chalk.red(result!.error));
    }
    results.push(result!);
  }

  const report = buildReport(runId, baseUrl, startedAt, results);
  writeReport(runDir, report);

  console.log(`\nReport: ${path.join(runDir, "report.html")}`);

  const failed = results.some(
    (r) => r.status === "fail" || r.status === "error",
  );
  return failed ? 1 : 0;
}

export async function executeAuthSave(
  authName: string,
  loginUrl: string | undefined,
  options: RunOptions,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);

  const apiKeyError = missingLlmApiKey(config);
  if (apiKeyError) {
    console.error(chalk.red(apiKeyError));
    return 2;
  }

  verifySkillsLock(cwd);

  const skillDirs = options.skillsDirs ?? config.skills.dirs;
  const allSkills = discoverSkills(skillDirs, cwd);
  const skills = requireSkills(allSkills, [
    ...config.skills.preloads,
    ...config.skills.activate,
  ]);

  const statePath =
    config.auth[authName]?.statePath ??
    path.join(".saq", "auth", `${authName}.json`);
  const resolvedState = path.resolve(cwd, statePath);
  mkdirSync(path.dirname(resolvedState), { recursive: true });

  const url = loginUrl ?? config.baseUrl;
  const spinner = ora(`Saving auth "${authName}"`).start();

  const result = await runAuthSave({
    config,
    skills,
    cwd,
    authName,
    loginUrl: url,
    statePath: resolvedState,
    headed: true,
    verbose: options.verbose,
  });

  if (result.success) {
    const updated = { ...config.auth, [authName]: { statePath } };
    writeFileSync(
      path.resolve(cwd, "saq.config.auth.json"),
      JSON.stringify({ auth: updated }, null, 2),
    );
    spinner.succeed(`Auth saved to ${statePath}`);
    console.log(
      chalk.dim(
        "Add to saq.config.ts: auth: { " +
          authName +
          ': { statePath: "' +
          statePath +
          '" } }',
      ),
    );
    return 0;
  }

  spinner.fail(result.error ?? "Auth save failed");
  return 1;
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

#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { PACKAGE_VERSION } from "../version.js";
import { loadEnv } from "../config/env.js";
import {
  executeRun,
  executeScenarioWorker,
  executeAuthList,
  executeAuthClear,
  executeClearCache,
  executeSkillsSync,
  executeSkillsList,
  executeSkillsShow,
} from "./run.js";
import { executeAnalyze } from "./analyze.js";
import {
  executeRecordStart,
  executeRecordStop,
  executeRecordNoteAsync,
  executeRecordCheckpointAsync,
  executeRecordGenerate,
} from "./record.js";
import type { RunOptions } from "../types/config.js";
import type { ScenarioTagFilterExpression } from "../types/scenario.js";
import { executeHelp } from "./help.js";
import { executeConfig } from "./config.js";
import {
  executeInstallBrowserChrome,
  executeInstallBrowserLightpanda,
} from "./install-browser.js";
import { executeMcpServe } from "./mcp.js";
import { collectAllTags, collectAnyTag, mergeTagFilters } from "./tags.js";

loadEnv();

function parseParallel(value: string | true | undefined): number {
  if (value === true || value === undefined || value === "") {
    return Number.POSITIVE_INFINITY;
  }
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new InvalidArgumentError(
      "--parallel requires a positive integer when a value is provided",
    );
  }
  return n;
}

function baseRunOptions(opts: {
  config?: string;
  tags?: ScenarioTagFilterExpression;
  tag?: ScenarioTagFilterExpression;
  skillsDir?: string[];
  verbose?: boolean;
  retries?: string;
  artifacts?: string;
  headed?: boolean;
  pause?: boolean;
  parallel?: number;
  failFast?: boolean;
  authRefresh?: boolean;
  keepBrowser?: boolean;
  noHealing?: boolean;
  noCache?: boolean;
  retriesPolicy?: string;
  reportOutput?: string;
  reportZip?: boolean;
}): RunOptions {
  const retriesPolicy =
    opts.retriesPolicy === "always" || opts.retriesPolicy === "transient"
      ? opts.retriesPolicy
      : undefined;
  return {
    configPath: opts.config,
    tags: mergeTagFilters(opts.tags, opts.tag),
    skillsDirs: opts.skillsDir,
    verbose: opts.verbose,
    retries: opts.retries ? parseInt(opts.retries, 10) : 0,
    artifacts: (opts.artifacts as RunOptions["artifacts"]) ?? "on-failure",
    headed: opts.headed,
    pause: opts.pause,
    parallel: opts.parallel,
    failFast: opts.failFast ?? false,
    authRefresh: opts.authRefresh,
    keepBrowser: opts.keepBrowser,
    noHealing: opts.noHealing,
    noCache: opts.noCache,
    retriesPolicy,
    reportOutputPath: opts.reportOutput,
    reportZip: opts.reportZip,
  };
}

const program = new Command();

program
  .name("pqa")
  .description("ProseQA — agent harness for NL E2E regression testing")
  .version(PACKAGE_VERSION);

program
  .command("_run-scenario", { hidden: true })
  .description("Internal: run a single scenario in an isolated subprocess")
  .requiredOption("--run-dir <path>", "Run artifact directory")
  .requiredOption("--scenario <path>", "Absolute path to scenario markdown file")
  .option("-c, --config <path>", "Config file path")
  .option("--skills-dir <dirs>", "Extra skill dirs (comma-separated)", (v: string) =>
    v.split(",").map((d) => d.trim()),
  )
  .option("--retries <n>", "Retries per failed scenario", "0")
  .option(
    "--retries-policy <policy>",
    "Retry policy when healing is enabled: transient|always",
    "transient",
  )
  .option("--no-healing", "Disable in-run recovery and transient-only retries")
  .option("--no-cache", "Do not load or write scenario replay hints cache")
  .option(
    "--artifacts <mode>",
    "Artifact mode: on-failure|always|never",
    "on-failure",
  )
  .option("--headed", "Run browser in headed mode")
  .option("--keep-browser", "Leave browser open after scenario")
  .option("--auth-refresh", "Re-run auth scenarios and refresh auth store")
  .option("--skip-pre-batch", "Internal: skip preBatch hooks")
  .option("-v, --verbose", "Verbose output")
  .action(async (opts) => {
    const code = await executeScenarioWorker(opts.scenario, opts.runDir, {
      configPath: opts.config,
      skillsDirs: opts.skillsDir,
      verbose: opts.verbose,
      retries: opts.retries ? parseInt(opts.retries, 10) : 0,
      artifacts: (opts.artifacts as RunOptions["artifacts"]) ?? "on-failure",
      headed: opts.headed,
      authRefresh: opts.authRefresh,
      keepBrowser: opts.keepBrowser,
      noHealing: opts.noHealing,
      noCache: opts.noCache,
      skipPreBatch: opts.skipPreBatch,
      skipPostBatch: opts.skipPreBatch,
      retriesPolicy:
        opts.retriesPolicy === "always" || opts.retriesPolicy === "transient"
          ? opts.retriesPolicy
          : undefined,
    });
    process.exit(code);
  });

program
  .command("run")
  .description("Run E2E scenarios (CI mode)")
  .argument(
    "[patterns...]",
    "Scenario glob patterns (default: all markdown under scenariosDir from config)",
  )
  .option("-c, --config <path>", "Config file path")
  .option(
    "--tags <tags>",
    "Comma-separated scenario tags; repeat for OR groups; use !tag to exclude",
    collectAllTags,
  )
  .option(
    "--tag <tag>",
    "Scenario tag; repeat for OR matching; use !tag to match absence",
    collectAnyTag,
  )
  .option("--skills-dir <dirs>", "Extra skill dirs (comma-separated)", (v: string) =>
    v.split(",").map((d) => d.trim()),
  )
  .option("--retries <n>", "Retries per failed scenario", "0")
  .option(
    "--retries-policy <policy>",
    "Retry policy when healing is enabled: transient|always",
    "transient",
  )
  .option("--no-healing", "Disable in-run recovery and transient-only retries")
  .option("--no-cache", "Do not load or write scenario replay hints cache")
  .option(
    "--artifacts <mode>",
    "Artifact mode: on-failure|always|never",
    "on-failure",
  )
  .option("--headed", "Run browser in headed mode")
  .option(
    "--keep-browser",
    "Leave browser open after each scenario (for local inspection)",
  )
  .option("--auth-refresh", "Re-run auth scenarios and refresh auth store")
  .option(
    "--parallel [n]",
    "Run scenarios in parallel subprocesses (optional max concurrency; next scenario starts when a slot frees)",
    parseParallel,
  )
  .option(
    "--fail-fast",
    "Stop remaining scenarios on first failure (default: run all)",
  )
  .option(
    "--report-output <path>",
    "Report output path (trailing / creates runId inside; otherwise full path)",
  )
  .option("--report-zip", "Emit report as zip instead of a directory")
  .action(async (patterns: string[], opts) => {
    const code = await executeRun(patterns, baseRunOptions(opts));
    process.exit(code);
  });

program
  .command("debug")
  .description("Run scenarios with verbose output (local debug)")
  .argument(
    "[patterns...]",
    "Scenario glob patterns (default: all markdown under scenariosDir from config)",
  )
  .option("-c, --config <path>", "Config file path")
  .option(
    "--tags <tags>",
    "Comma-separated scenario tags; repeat for OR groups; use !tag to exclude",
    collectAllTags,
  )
  .option(
    "--tag <tag>",
    "Scenario tag; repeat for OR matching; use !tag to match absence",
    collectAnyTag,
  )
  .option("--skills-dir <dirs>", "Extra skill dirs (comma-separated)", (v: string) =>
    v.split(",").map((d) => d.trim()),
  )
  .option("--pause", "Pause between agent turns")
  .option(
    "--keep-browser",
    "Leave browser open after each scenario (for local inspection)",
  )
  .option("--auth-refresh", "Re-run auth scenarios and refresh auth store")
  .option("--retries <n>", "Retries", "0")
  .option(
    "--retries-policy <policy>",
    "Retry policy when healing is enabled: transient|always",
    "transient",
  )
  .option("--no-healing", "Disable in-run recovery and transient-only retries")
  .option("--no-cache", "Do not load or write scenario replay hints cache")
  .option(
    "--parallel [n]",
    "Run scenarios in parallel subprocesses (optional max concurrency; next scenario starts when a slot frees)",
    parseParallel,
  )
  .option(
    "--fail-fast",
    "Stop remaining scenarios on first failure (default: run all)",
  )
  .option("--no-headed", "Run browser headless")
  .option(
    "--report-output <path>",
    "Report output path (trailing / creates runId inside; otherwise full path)",
  )
  .option("--report-zip", "Emit report as zip instead of a directory")
  .action(async (patterns: string[], opts) => {
    const code = await executeRun(patterns, {
      ...baseRunOptions({
        ...opts,
        verbose: true,
        headed: opts.headed !== false,
      }),
      pause: opts.pause,
    });
    process.exit(code);
  });

const auth = program.command("auth").description("Authentication helpers");

auth
  .command("list")
  .description("List cached auth profiles in the auth store")
  .action(() => {
    process.exit(executeAuthList());
  });

auth
  .command("clear [profile]")
  .description("Clear cached auth state (all profiles or one profile)")
  .action((profile?: string) => {
    process.exit(executeAuthClear(profile));
  });

const skills = program.command("skills").description("Manage skills");

skills
  .command("list")
  .description("List discovered skills")
  .option("--skills-dir <dirs>", "Skill directories")
  .action((opts: { skillsDir?: string }) => {
    const dirs = opts.skillsDir
      ? opts.skillsDir.split(",").map((d) => d.trim())
      : ["skills", ".agents/skills"];
    executeSkillsList(dirs);
  });

skills
  .command("show")
  .description("Show full skill content")
  .argument("<name>", "Skill name")
  .option("--skills-dir <dirs>", "Skill directories")
  .action((name: string, opts: { skillsDir?: string }) => {
    const dirs = opts.skillsDir
      ? opts.skillsDir.split(",").map((d) => d.trim())
      : ["skills", ".agents/skills"];
    process.exit(executeSkillsShow(name, dirs));
  });

skills
  .command("sync")
  .description("Sync agent-browser skill from pinned npm version")
  .action(() => {
    process.exit(executeSkillsSync());
  });

const record = program.command("record").description("Record browser sessions and generate scenarios");

record
  .command("start")
  .description("Start recording (headed agent-browser session)")
  .option("-c, --config <path>", "Config file path")
  .option("--url <url>", "URL to open when recording starts")
  .option("--no-headed", "Run headless (not recommended)")
  .option("--session <name>", "agent-browser session name")
  .option("--connect <port>", "Connect to Chrome CDP port instead of launching", (v) =>
    parseInt(v, 10),
  )
  .option("-v, --verbose", "Verbose browser output")
  .action(async (opts) => {
    const code = await executeRecordStart({
      configPath: opts.config,
      url: opts.url,
      headed: opts.headed !== false,
      session: opts.session,
      connect: opts.connect,
      verbose: opts.verbose,
    });
    process.exit(code);
  });

record
  .command("note <text>")
  .description("Add a free-form comment to the active recording")
  .option("-c, --config <path>", "Config file path")
  .action(async (text: string, opts) => {
    process.exit(await executeRecordNoteAsync(text, opts.config));
  });

record
  .command("checkpoint <text>")
  .description("Add a checkpoint hint for the Then section")
  .option("-c, --config <path>", "Config file path")
  .action(async (text: string, opts) => {
    process.exit(await executeRecordCheckpointAsync(text, opts.config));
  });

record
  .command("stop")
  .description("Stop recording and generate scenario markdown")
  .option("-c, --config <path>", "Config file path")
  .option("--name <name>", "Scenario name (kebab-case)")
  .option("--out <path>", "Output markdown path")
  .option("--no-generate", "Only save events, skip LLM generation")
  .option("-v, --verbose", "Verbose")
  .action(async (opts) => {
    const code = await executeRecordStop({
      configPath: opts.config,
      name: opts.name,
      out: opts.out,
      skipGenerate: opts.noGenerate,
      verbose: opts.verbose,
    });
    process.exit(code);
  });

record
  .command("generate <recordingDir>")
  .description("Generate scenario.md from a saved recording directory")
  .option("-c, --config <path>", "Config file path")
  .option("--name <name>", "Scenario name")
  .option("--out <path>", "Output markdown path")
  .action(async (recordingDir: string, opts) => {
    const code = await executeRecordGenerate(recordingDir, {
      configPath: opts.config,
      name: opts.name,
      out: opts.out,
    });
    process.exit(code);
  });

const installBrowser = program
  .command("install-browser")
  .description("Install browser binaries for agent-browser");

installBrowser
  .command("chrome")
  .description("Install Chromium and system deps via agent-browser")
  .action(() => {
    process.exit(executeInstallBrowserChrome());
  });

installBrowser
  .command("lightpanda")
  .description("Download the Lightpanda browser binary for this OS/arch")
  .action(() => {
    process.exit(executeInstallBrowserLightpanda());
  });

program
  .command("config <key> <value>")
  .description("Set a value in pqa.config.json (creates the file if missing)")
  .action(async (key: string, value: string) => {
    process.exit(await executeConfig(key, value));
  });

program
  .command("clear-cache [scenario]")
  .description("Clear scenario replay hints cache (one scenario or all)")
  .option("-c, --config <path>", "Config file path")
  .action(async (scenario: string | undefined, opts: { config?: string }) => {
    process.exit(await executeClearCache(scenario, opts.config));
  });

program
  .command("analyze")
  .description("Analyze run(s) (heuristics + LLM) and review fixes interactively")
  .argument("[runPathOrId...]", "Run directory or id under .pqa/runs/")
  .option("--config <path>", "Path to pqa.config file")
  .option(
    "--last <n>",
    "Compare the N most recent runs for flaky scenarios",
    (v: string) => parseInt(v, 10),
  )
  .action(async (runPathOrIds: string[], opts) => {
    const code = await executeAnalyze(runPathOrIds, {
      configPath: opts.config,
      last: opts.last,
    });
    process.exit(code);
  });

program
  .command("help [command...]")
  .description("Show help for commands and options")
  .action((command: string[]) => {
    process.exit(executeHelp(command));
  });

program
  .command("mcp")
  .description(
    "Start MCP server (stdio): create-pqa-scenario skill, validate/run inline scenario markdown",
  )
  .action(async () => {
    process.exit(await executeMcpServe());
  });

program.parse();

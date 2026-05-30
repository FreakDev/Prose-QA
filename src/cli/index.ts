#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { loadEnv } from "../config/env.js";
import {
  executeRun,
  executeAuthSave,
  executeSkillsSync,
  executeSkillsList,
  executeSkillsShow,
} from "./run.js";
import type { RunOptions } from "../types/config.js";

loadEnv();

const program = new Command();

program
  .name("saq")
  .description("Agent harness for NL E2E regression testing")
  .version("0.1.0");

const sharedOptions = (cmd: Command) =>
  cmd
    .option("-c, --config <path>", "Config file path")
    .option("--base-url <url>", "Target app base URL")
    .option("--tags <tags>", "Comma-separated scenario tags", (v: string) =>
      v.split(",").map((t) => t.trim()),
    )
    .option("--skills-dir <dirs>", "Extra skill dirs (comma-separated)", (v: string) =>
      v.split(",").map((d) => d.trim()),
    )
    .option("-v, --verbose", "Verbose output");

function baseRunOptions(opts: {
  config?: string;
  baseUrl?: string;
  tags?: string[];
  skillsDir?: string[];
  verbose?: boolean;
  retries?: string;
  artifacts?: string;
  headed?: boolean;
  pause?: boolean;
}): RunOptions {
  return {
    configPath: opts.config,
    baseUrl: opts.baseUrl,
    tags: opts.tags,
    skillsDirs: opts.skillsDir,
    verbose: opts.verbose,
    retries: opts.retries ? parseInt(opts.retries, 10) : 0,
    artifacts: (opts.artifacts as RunOptions["artifacts"]) ?? "on-failure",
    headed: opts.headed,
    pause: opts.pause,
  };
}

program
  .command("run")
  .description("Run E2E scenarios (CI mode)")
  .argument("[patterns...]", "Scenario glob patterns", ["scenarios/**/*.md"])
  .option("--retries <n>", "Retries per failed scenario", "0")
  .option(
    "--artifacts <mode>",
    "Artifact mode: on-failure|always|never",
    "on-failure",
  )
  .option("--headed", "Run browser in headed mode")
  .action(async (patterns: string[], opts) => {
    const code = await executeRun(patterns, baseRunOptions(opts));
    process.exit(code);
  });

program
  .command("debug")
  .description("Run a single scenario with verbose output")
  .argument("<scenario>", "Scenario file path")
  .option("--pause", "Pause between agent turns")
  .option("--retries <n>", "Retries", "0")
  .option("--headed", "Headed browser", true)
  .action(async (scenario: string, opts) => {
    const code = await executeRun(
      [scenario],
      {
        ...baseRunOptions({ ...opts, verbose: true, headed: opts.headed ?? true }),
        pause: opts.pause,
      },
    );
    process.exit(code);
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

const auth = program.command("auth").description("Authentication helpers");

auth
  .command("save <name> [loginUrl]")
  .description("Interactive auth state save")
  .option("-c, --config <path>", "Config file path")
  .option("-v, --verbose", "Verbose")
  .action(async (name: string, loginUrl: string | undefined, opts) => {
    const code = await executeAuthSave(name, loginUrl, {
      configPath: opts.config,
      verbose: opts.verbose,
      artifacts: "never",
    });
    process.exit(code);
  });

program.parse();

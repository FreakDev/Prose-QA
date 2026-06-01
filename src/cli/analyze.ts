import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  analyzeRun,
  loadRunReport,
  resolveRunDirs,
  type AnalyzeReport,
} from "../analyze/index.js";
import {
  buildFlakyAnalyzeContext,
  buildLlmAnalyzeContext,
  flakyFindingToAnalyzeFinding,
} from "../analyze/build-context.js";
import { compareRuns } from "../analyze/compare-runs.js";
import {
  proposeFlakyScenarioFixWithLlm,
  proposeScenarioFixWithLlm,
} from "../analyze/llm-fix.js";
import type { ScenarioFixProposal } from "../analyze/parse-proposal.js";
import { runAnalyzeRepl, type LlmReplEntry } from "../analyze/repl.js";
import {
  loadConfig,
  missingLlmApiKey,
} from "../config/load.js";

export interface AnalyzeOptions {
  configPath?: string;
  last?: number;
}

export interface LlmAnalyzeEntry {
  scenario: string;
  filePath: string;
  proposal: ScenarioFixProposal | null;
  parseError?: string;
  applied?: boolean;
}

export interface LlmAnalyzeReport {
  runId: string;
  analyzedAt: string;
  entries: LlmAnalyzeEntry[];
}

function analyzeOutputDir(cwd: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(cwd, ".pqa", "analyze", ts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function executeSingleRunAnalyze(
  runDir: string,
  cwd: string,
  configPath?: string,
): Promise<number> {
  const report = analyzeRun(runDir, cwd);
  const runReport = loadRunReport(runDir);

  writeFileSync(
    path.join(runDir, "analyze.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const config = await loadConfig(configPath, cwd);
  if (report.findings.length > 0) {
    const missingKey = missingLlmApiKey(config);
    if (missingKey) {
      throw new Error(missingKey);
    }
  }

  const llmReport: LlmAnalyzeReport = {
    runId: report.runId,
    analyzedAt: new Date().toISOString(),
    entries: [],
  };

  const replEntries: LlmReplEntry[] = [];

  for (const finding of report.findings) {
    const result = runReport.results.find((r) => r.scenario === finding.scenario);
    if (!result) continue;

    const spinner = ora(`LLM analysis: ${finding.scenario}`).start();
    const context = buildLlmAnalyzeContext(finding, result, cwd);
    const llmResult = await proposeScenarioFixWithLlm(config, context, cwd);
    spinner.stop();

    const entry: LlmAnalyzeEntry = {
      scenario: finding.scenario,
      filePath: finding.filePath,
      proposal: llmResult.proposal,
      parseError: llmResult.parseError,
    };

    replEntries.push({
      finding,
      proposal: llmResult.proposal,
      parseError: llmResult.parseError,
    });

    llmReport.entries.push(entry);
  }

  writeFileSync(
    path.join(runDir, "analyze-llm.json"),
    `${JSON.stringify(llmReport, null, 2)}\n`,
  );

  const replResult = await runAnalyzeRepl({
    heuristicReport: report,
    llmEntries: replEntries,
    cwd,
  });

  for (const entry of llmReport.entries) {
    const target = path.resolve(cwd, entry.filePath);
    entry.applied = replResult.appliedFiles.some(
      (p) => path.resolve(p) === target,
    );
  }

  writeFileSync(
    path.join(runDir, "analyze-llm.json"),
    `${JSON.stringify(llmReport, null, 2)}\n`,
  );

  console.log(
    chalk.dim(
      `\nReports: ${path.join(runDir, "analyze.json")}, ${path.join(runDir, "analyze-llm.json")}`,
    ),
  );

  return 0;
}

async function executeMultiRunAnalyze(
  runDirs: string[],
  cwd: string,
  configPath?: string,
): Promise<number> {
  const flakyReport = compareRuns(runDirs, cwd);
  const outDir = analyzeOutputDir(cwd);

  writeFileSync(
    path.join(outDir, "analyze-flaky.json"),
    `${JSON.stringify(flakyReport, null, 2)}\n`,
  );

  if (flakyReport.findings.length === 0) {
    console.log(
      chalk.green(
        `\nNo flaky scenarios across ${flakyReport.runIds.length} run(s).`,
      ),
    );
    console.log(chalk.dim(`Report: ${path.join(outDir, "analyze-flaky.json")}`));
    return 0;
  }

  const config = await loadConfig(configPath, cwd);
  const missingKey = missingLlmApiKey(config);
  if (missingKey) {
    throw new Error(missingKey);
  }

  const llmReport: LlmAnalyzeReport = {
    runId: flakyReport.runIds.join(","),
    analyzedAt: new Date().toISOString(),
    entries: [],
  };

  const replEntries: LlmReplEntry[] = [];

  for (const finding of flakyReport.findings) {
    const spinner = ora(`LLM flaky analysis: ${finding.scenario}`).start();
    const context = buildFlakyAnalyzeContext(finding, runDirs, cwd);
    const llmResult = await proposeFlakyScenarioFixWithLlm(config, context, cwd);
    spinner.stop();

    const analyzeFinding = flakyFindingToAnalyzeFinding(finding);

    const entry: LlmAnalyzeEntry = {
      scenario: finding.scenario,
      filePath: finding.filePath,
      proposal: llmResult.proposal,
      parseError: llmResult.parseError,
    };

    replEntries.push({
      finding: analyzeFinding,
      proposal: llmResult.proposal,
      parseError: llmResult.parseError,
    });

    llmReport.entries.push(entry);
  }

  writeFileSync(
    path.join(outDir, "analyze-llm.json"),
    `${JSON.stringify(llmReport, null, 2)}\n`,
  );

  const placeholderReport: AnalyzeReport = {
    runId: flakyReport.runIds.join(","),
    analyzedAt: flakyReport.analyzedAt,
    findings: replEntries.map((e) => e.finding),
  };

  const replResult = await runAnalyzeRepl({
    heuristicReport: placeholderReport,
    flakyReport,
    llmEntries: replEntries,
    cwd,
  });

  for (const entry of llmReport.entries) {
    const target = path.resolve(cwd, entry.filePath);
    entry.applied = replResult.appliedFiles.some(
      (p) => path.resolve(p) === target,
    );
  }

  writeFileSync(
    path.join(outDir, "analyze-llm.json"),
    `${JSON.stringify(llmReport, null, 2)}\n`,
  );

  console.log(
    chalk.dim(
      `\nReports: ${path.join(outDir, "analyze-flaky.json")}, ${path.join(outDir, "analyze-llm.json")}`,
    ),
  );

  return 0;
}

export async function executeAnalyze(
  runIds: string[],
  options: AnalyzeOptions,
): Promise<number> {
  const cwd = process.cwd();

  try {
    if (!process.stdin.isTTY) {
      throw new Error("pqa analyze requires an interactive terminal");
    }

    const runDirs = resolveRunDirs(cwd, runIds, options.last);

    if (runDirs.length === 1) {
      return await executeSingleRunAnalyze(runDirs[0]!, cwd, options.configPath);
    }

    if (runDirs.length < 2) {
      throw new Error("Multi-run analysis requires at least 2 run sessions");
    }

    return await executeMultiRunAnalyze(runDirs, cwd, options.configPath);
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }
}

export type { AnalyzeReport };

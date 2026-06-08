import { writeFileSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  analyzeRun,
  loadRunReport,
  resolveRunDir,
  type AnalyzeReport,
} from "../analyze/index.js";
import { buildLlmAnalyzeContext } from "../analyze/build-context.js";
import { proposeScenarioFixWithLlm } from "../analyze/llm-fix.js";
import type { ScenarioFixProposal } from "../analyze/parse-proposal.js";
import { runAnalyzeRepl, type LlmReplEntry } from "../analyze/repl.js";
import {
  loadConfig,
  missingLlmApiKey,
} from "../config/load.js";

export interface AnalyzeOptions {
  configPath?: string;
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

export async function executeAnalyze(
  runPathOrId: string | undefined,
  options: AnalyzeOptions,
): Promise<number> {
  const cwd = process.cwd();

  try {
    if (!process.stdin.isTTY) {
      throw new Error("pqa analyze requires an interactive terminal");
    }

    const runDir = resolveRunDir(cwd, runPathOrId);
    const report = analyzeRun(runDir, cwd);
    const runReport = loadRunReport(runDir);

    writeFileSync(
      path.join(runDir, "analyze.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    const config = await loadConfig(options.configPath, cwd);
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
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }
}

export type { AnalyzeReport };

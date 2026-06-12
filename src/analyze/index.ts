import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { classifyFailure } from "../healing/classify.js";
import { parseScenarioFile } from "../scenarios/parser.js";
import type { RunReport } from "../types/verdict.js";
import type { FailureKind } from "../types/verdict.js";
import { suggestScenarioFixes } from "./suggest.js";

export interface AnalyzeFinding {
  scenario: string;
  filePath: string;
  status: string;
  failureKind: FailureKind;
  confidence: string;
  suggestions: string[];
  signals: string[];
}

export interface AnalyzeReport {
  runId: string;
  analyzedAt: string;
  findings: AnalyzeFinding[];
}

export function listRunDirs(cwd: string): string[] {
  const runsRoot = path.join(cwd, ".pqa", "runs");
  if (!existsSync(runsRoot)) {
    throw new Error(`No runs directory at ${runsRoot}`);
  }
  const dirs = readdirSync(runsRoot)
    .map((name) => path.join(runsRoot, name))
    .filter((p) => statSync(p).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (dirs.length === 0) {
    throw new Error(`No runs found under ${runsRoot}`);
  }
  return dirs;
}

export function resolveRunDir(cwd: string, runPathOrId?: string): string {
  if (!runPathOrId) {
    return listRunDirs(cwd)[0]!;
  }

  const runsRoot = path.join(cwd, ".pqa", "runs");
  const resolved = path.isAbsolute(runPathOrId)
    ? runPathOrId
    : path.resolve(cwd, runPathOrId);

  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return resolved;
  }

  const byId = path.join(runsRoot, runPathOrId);
  if (existsSync(byId) && statSync(byId).isDirectory()) {
    return byId;
  }

  throw new Error(`Run directory not found: ${runPathOrId}`);
}

export function resolveRunDirs(
  cwd: string,
  runIds: string[],
  lastN?: number,
): string[] {
  if (runIds.length > 0) {
    return runIds.map((id) => resolveRunDir(cwd, id));
  }

  if (lastN !== undefined) {
    if (lastN < 2) {
      throw new Error("--last requires at least 2 runs for multi-run analysis");
    }
    const dirs = listRunDirs(cwd);
    if (dirs.length < 2) {
      throw new Error(
        `Multi-run analysis requires at least 2 runs; found ${dirs.length}`,
      );
    }
    return dirs.slice(0, lastN);
  }

  return [resolveRunDir(cwd)];
}

export function loadRunReport(runDir: string): RunReport {
  const reportPath = path.join(runDir, "report.json");
  if (!existsSync(reportPath)) {
    throw new Error(`Missing report.json in ${runDir}`);
  }
  return JSON.parse(readFileSync(reportPath, "utf-8")) as RunReport;
}

export function analyzeRun(runDir: string, cwd: string): AnalyzeReport {
  const report = loadRunReport(runDir);
  const findings: AnalyzeFinding[] = [];

  for (const result of report.results) {
    if (result.status !== "fail" && result.status !== "error") continue;

    let scenario;
    try {
      scenario = parseScenarioFile(
        path.isAbsolute(result.filePath)
          ? result.filePath
          : path.resolve(cwd, result.filePath),
      );
    } catch {
      scenario = undefined;
    }

    const classified = classifyFailure(result, scenario);
    const suggestions = suggestScenarioFixes(result, scenario, classified);

    findings.push({
      scenario: result.scenario,
      filePath: result.filePath,
      status: result.status,
      failureKind: classified.kind,
      confidence: classified.confidence,
      suggestions,
      signals: classified.signals,
    });
  }

  return {
    runId: report.runId,
    analyzedAt: new Date().toISOString(),
    findings,
  };
}

export function formatAnalyzeReport(report: AnalyzeReport): string {
  if (report.findings.length === 0) {
    return chalk.green(`Run ${report.runId}: no failed scenarios to analyze.`);
  }

  const lines: string[] = [
    chalk.bold(`Analyze run ${report.runId}`),
    chalk.dim(`Analyzed at ${report.analyzedAt}`),
    "",
  ];

  for (const f of report.findings) {
    const kindColor =
      f.failureKind === "scenario_issue"
        ? chalk.yellow
        : f.failureKind === "product"
          ? chalk.red
          : f.failureKind === "infrastructure"
            ? chalk.magenta
            : f.failureKind === "transient"
              ? chalk.cyan
              : chalk.gray;

    lines.push(
      `${chalk.bold(f.scenario)} ${chalk.dim(`(${f.status})`)} — ${kindColor(f.failureKind)} [${f.confidence}]`,
    );
    if (f.signals.length > 0) {
      lines.push(chalk.dim(`  signals: ${f.signals.join(", ")}`));
    }
    for (const s of f.suggestions) {
      lines.push(`  • ${s}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

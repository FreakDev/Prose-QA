import { readFileSync } from "node:fs";
import path from "node:path";
import { parseScenarioFile } from "../scenarios/parser.js";
import type { AnalyzeFinding } from "./index.js";
import type {
  FlakyScenarioFinding,
  RunOccurrence,
} from "./compare-runs.js";
import { selectRepresentativeRuns } from "./compare-runs.js";
import { loadRunReport } from "./index.js";
import type { ScenarioResult, TranscriptEntry } from "../types/verdict.js";

const MAX_TRANSCRIPT_ENTRIES = 28;
const MAX_STDOUT_CHARS = 1500;
const MAX_MESSAGE_CHARS = 2000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export interface ScenarioIntentContext {
  name: string;
  url?: string;
  auth?: string;
  tags?: string[];
  goal: string;
  steps: string;
  then: string[];
}

export interface TruncatedScenarioResult {
  scenario: string;
  filePath: string;
  status: string;
  error?: string;
  durationMs?: number;
  verdict: ScenarioResult["verdict"];
  transcript: {
    entries: TranscriptEntry[];
  };
  healing?: ScenarioResult["healing"];
}

export interface LlmAnalyzeContext {
  heuristicFinding: AnalyzeFinding;
  scenarioIntent: ScenarioIntentContext | null;
  scenarioResult: TruncatedScenarioResult;
  scenarioMarkdown: string;
}

export interface FlakyLlmAnalyzeContext extends LlmAnalyzeContext {
  runComparison: {
    runIds: string[];
    stats: { pass: number; fail: number; error: number };
    inconsistentCheckpoints: FlakyScenarioFinding["inconsistentCheckpoints"];
    filePathWarnings: string[];
    representativeRuns: {
      pass?: TruncatedScenarioResult;
      fail?: TruncatedScenarioResult;
    };
    otherRuns: Array<{
      runId: string;
      status: RunOccurrence["status"];
      verdictSummary?: string;
      failedCheckpoints: string[];
    }>;
  };
}

export function buildScenarioIntent(
  filePath: string,
): ScenarioIntentContext | null {
  try {
    const scenario = parseScenarioFile(filePath);
    return {
      name: scenario.frontmatter.name,
      url: scenario.frontmatter.url,
      auth: scenario.frontmatter.auth,
      tags: scenario.frontmatter.tags,
      goal: scenario.goal,
      steps: scenario.steps,
      then: scenario.then,
    };
  } catch {
    return null;
  }
}

export function truncateScenarioResult(
  result: ScenarioResult,
): TruncatedScenarioResult {
  const entries = result.transcript.entries
    .slice(-MAX_TRANSCRIPT_ENTRIES)
    .map((entry): TranscriptEntry => {
      if (entry.type === "message") {
        return {
          type: "message",
          role: entry.role,
          content: truncate(entry.content, MAX_MESSAGE_CHARS),
          ...(entry.thinking
            ? { thinking: truncate(entry.thinking, MAX_MESSAGE_CHARS) }
            : {}),
        };
      }
      return {
        type: "bash",
        command: entry.command,
        exitCode: entry.exitCode,
        stdout: truncate(entry.stdout, MAX_STDOUT_CHARS),
        stderr: truncate(entry.stderr, 500),
        durationMs: entry.durationMs,
      };
    });

  return {
    scenario: result.scenario,
    filePath: result.filePath,
    status: result.status,
    error: result.error,
    durationMs: result.durationMs,
    verdict: result.verdict,
    transcript: { entries },
    healing: result.healing,
  };
}

export function buildLlmAnalyzeContext(
  finding: AnalyzeFinding,
  result: ScenarioResult,
  cwd: string,
): LlmAnalyzeContext {
  const scenarioPath = path.isAbsolute(result.filePath)
    ? result.filePath
    : path.resolve(cwd, result.filePath);

  const scenarioMarkdown = readFileSync(scenarioPath, "utf-8");
  const scenarioIntent = buildScenarioIntent(scenarioPath);

  return {
    heuristicFinding: finding,
    scenarioIntent,
    scenarioResult: truncateScenarioResult(result),
    scenarioMarkdown,
  };
}

function syntheticFindingFromFlaky(
  finding: FlakyScenarioFinding,
): AnalyzeFinding {
  const assessment = finding.heuristicAssessment;
  return {
    scenario: finding.scenario,
    filePath: finding.filePath,
    status: finding.failCount > 0 ? "fail" : "error",
    failureKind: assessment.dominantKind,
    confidence: assessment.likelyFalseNegative ? "high" : "medium",
    suggestions: assessment.suggestions,
    signals: finding.runs.flatMap((r) => r.signals ?? []).slice(0, 6),
  };
}

export function buildFlakyAnalyzeContext(
  finding: FlakyScenarioFinding,
  runDirs: string[],
  cwd: string,
): FlakyLlmAnalyzeContext {
  const reports = runDirs.map((runDir) => ({
    runDir,
    report: loadRunReport(runDir),
  }));

  const entries = reports.flatMap(({ report }) =>
    report.results
      .filter((r) => (r.scenario || r.filePath) === finding.scenario)
      .map((result) => ({ runId: report.runId, result })),
  );

  const { pass: passEntry, fail: failEntry } = selectRepresentativeRuns(entries);
  const representativeRunIds = new Set(
    [passEntry?.runId, failEntry?.runId].filter(Boolean),
  );

  const otherRuns = entries
    .filter(({ runId }) => !representativeRunIds.has(runId))
    .map(({ runId, result }) => ({
      runId,
      status: result.status,
      verdictSummary: result.verdict?.summary,
      failedCheckpoints:
        result.verdict?.checkpoints
          .filter((c) => !c.pass)
          .map((c) => c.assertion) ?? [],
    }));

  const baseResult = failEntry?.result ?? passEntry?.result ?? entries[0]!.result;
  const base = buildLlmAnalyzeContext(
    syntheticFindingFromFlaky(finding),
    baseResult,
    cwd,
  );

  return {
    ...base,
    runComparison: {
      runIds: finding.runs.map((r) => r.runId),
      stats: {
        pass: finding.passCount,
        fail: finding.failCount,
        error: finding.errorCount,
      },
      inconsistentCheckpoints: finding.inconsistentCheckpoints,
      filePathWarnings: finding.filePathWarnings,
      representativeRuns: {
        ...(passEntry
          ? { pass: truncateScenarioResult(passEntry.result) }
          : {}),
        ...(failEntry
          ? { fail: truncateScenarioResult(failEntry.result) }
          : {}),
      },
      otherRuns,
    },
  };
}

export function flakyFindingToAnalyzeFinding(
  finding: FlakyScenarioFinding,
): AnalyzeFinding {
  return syntheticFindingFromFlaky(finding);
}

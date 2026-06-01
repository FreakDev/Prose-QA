import path from "node:path";
import { classifyFailure } from "../healing/classify.js";
import { parseScenarioFile } from "../scenarios/parser.js";
import type { FailureKind } from "../types/verdict.js";
import type { RunReport, ScenarioResult } from "../types/verdict.js";
import { suggestScenarioFixes } from "./suggest.js";
import { loadRunReport } from "./index.js";

const INFRA_ERROR_MS = 5000;

export interface RunOccurrence {
  runId: string;
  status: "pass" | "fail" | "error" | "skipped";
  durationMs: number;
  failedCheckpoints: string[];
  failureKind?: FailureKind;
  signals?: string[];
  healingUsed?: boolean;
  errorIntermittent?: boolean;
}

export interface FlakyScenarioFinding {
  scenario: string;
  filePath: string;
  filePathWarnings: string[];
  runCount: number;
  passCount: number;
  failCount: number;
  errorCount: number;
  inconsistentCheckpoints: Array<{
    assertion: string;
    passedIn: string[];
    failedIn: string[];
  }>;
  runs: RunOccurrence[];
  heuristicAssessment: {
    dominantKind: FailureKind;
    likelyFalseNegative: boolean;
    likelyFalsePositive: boolean;
    suggestions: string[];
  };
}

export interface FlakyAnalyzeReport {
  runIds: string[];
  analyzedAt: string;
  findings: FlakyScenarioFinding[];
}

interface ScenarioRunEntry {
  runId: string;
  result: ScenarioResult;
}

function scenarioKey(result: ScenarioResult): string {
  return result.scenario || result.filePath;
}

function failedCheckpoints(result: ScenarioResult): string[] {
  return (
    result.verdict?.checkpoints.filter((c) => !c.pass).map((c) => c.assertion) ??
    []
  );
}

function isInfraError(result: ScenarioResult): boolean {
  return result.status === "error" && result.durationMs < INFRA_ERROR_MS;
}

function statusSet(entries: RunOccurrence[]): Set<string> {
  const relevant = entries.filter((e) => !e.errorIntermittent);
  return new Set(relevant.map((e) => e.status));
}

function isVerdictInconsistent(entries: RunOccurrence[]): boolean {
  const relevant = entries.filter((e) => !e.errorIntermittent);
  if (relevant.length < 2) return false;

  const statuses = statusSet(entries);
  const hasPass = statuses.has("pass");
  const hasFail = statuses.has("fail") || statuses.has("error");
  if (hasPass && hasFail) return true;

  return false;
}

function buildInconsistentCheckpoints(
  entries: ScenarioRunEntry[],
): FlakyScenarioFinding["inconsistentCheckpoints"] {
  const byAssertion = new Map<
    string,
    { passedIn: string[]; failedIn: string[] }
  >();

  for (const { runId, result } of entries) {
    if (isInfraError(result)) continue;
    for (const cp of result.verdict?.checkpoints ?? []) {
      let bucket = byAssertion.get(cp.assertion);
      if (!bucket) {
        bucket = { passedIn: [], failedIn: [] };
        byAssertion.set(cp.assertion, bucket);
      }
      if (cp.pass) {
        bucket.passedIn.push(runId);
      } else {
        bucket.failedIn.push(runId);
      }
    }
  }

  const inconsistent: FlakyScenarioFinding["inconsistentCheckpoints"] = [];
  for (const [assertion, bucket] of byAssertion) {
    if (bucket.passedIn.length > 0 && bucket.failedIn.length > 0) {
      inconsistent.push({ assertion, ...bucket });
    }
  }
  return inconsistent;
}

function buildRunOccurrence(
  runId: string,
  result: ScenarioResult,
  cwd: string,
): RunOccurrence {
  const errorIntermittent = isInfraError(result);
  const occurrence: RunOccurrence = {
    runId,
    status: result.status,
    durationMs: result.durationMs,
    failedCheckpoints: failedCheckpoints(result),
    healingUsed: result.healing?.used ?? false,
    errorIntermittent,
  };

  if (result.status === "fail" || result.status === "error") {
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
    occurrence.failureKind = classified.kind;
    occurrence.signals = classified.signals;
  }

  return occurrence;
}

function dominantFailureKind(
  runs: RunOccurrence[],
): FailureKind {
  const counts = new Map<FailureKind, number>();
  for (const run of runs) {
    if (!run.failureKind) continue;
    counts.set(run.failureKind, (counts.get(run.failureKind) ?? 0) + 1);
  }
  let best: FailureKind = "unknown";
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

function buildHeuristicAssessment(
  runs: RunOccurrence[],
  inconsistentCheckpoints: FlakyScenarioFinding["inconsistentCheckpoints"],
  failEntries: ScenarioRunEntry[],
  cwd: string,
): FlakyScenarioFinding["heuristicAssessment"] {
  const dominantKind = dominantFailureKind(runs);
  const hasPass = runs.some((r) => r.status === "pass" && !r.errorIntermittent);
  const hasFail = runs.some(
    (r) =>
      (r.status === "fail" || r.status === "error") && !r.errorIntermittent,
  );
  const passWithHealing = runs.some(
    (r) => r.status === "pass" && r.healingUsed === true,
  );

  const likelyFalseNegative =
    hasPass &&
    hasFail &&
    (dominantKind === "scenario_issue" ||
      inconsistentCheckpoints.some((cp) => cp.failedIn.length > 0));

  const likelyFalsePositive = hasPass && (passWithHealing || hasFail === false);

  const suggestions = new Set<string>();
  if (likelyFalseNegative) {
    suggestions.add(
      "Pass and fail disagree — review Then placement or assertion strictness (possible false negative).",
    );
  }
  if (passWithHealing) {
    suggestions.add(
      "At least one pass used healing recovery — pass may hide an unstable flow (possible false positive).",
    );
  }
  if (dominantKind === "transient") {
    suggestions.add("Failures look timing-related — add explicit waits after navigation or submit.");
  }
  for (const cp of inconsistentCheckpoints) {
    suggestions.add(
      `Checkpoint "${cp.assertion}" flips between pass and fail — stabilize timing or move check earlier.`,
    );
  }

  for (const { result } of failEntries) {
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
    for (const s of suggestScenarioFixes(result, scenario, classified)) {
      suggestions.add(s);
    }
  }

  return {
    dominantKind,
    likelyFalseNegative,
    likelyFalsePositive,
    suggestions: [...suggestions].slice(0, 8),
  };
}

export function selectRepresentativeRuns(
  entries: ScenarioRunEntry[],
): { pass?: ScenarioRunEntry; fail?: ScenarioRunEntry } {
  const sorted = [...entries].sort((a, b) => b.runId.localeCompare(a.runId));
  const pass = sorted.find(
    (e) => e.result.status === "pass" && !isInfraError(e.result),
  );
  const fail = sorted.find(
    (e) =>
      (e.result.status === "fail" || e.result.status === "error") &&
      !isInfraError(e.result),
  );
  return { pass, fail };
}

export function compareRuns(runDirs: string[], cwd: string): FlakyAnalyzeReport {
  const reports: Array<{ runDir: string; report: RunReport }> = runDirs.map(
    (runDir) => ({
      runDir,
      report: loadRunReport(runDir),
    }),
  );

  const runIds = reports.map(({ report }) => report.runId);
  const byScenario = new Map<string, ScenarioRunEntry[]>();

  for (const { report } of reports) {
    for (const result of report.results) {
      const key = scenarioKey(result);
      const list = byScenario.get(key) ?? [];
      list.push({ runId: report.runId, result });
      byScenario.set(key, list);
    }
  }

  const findings: FlakyScenarioFinding[] = [];

  for (const [scenario, entries] of byScenario) {
    if (entries.length < 2) continue;

    const runs = entries.map(({ runId, result }) =>
      buildRunOccurrence(runId, result, cwd),
    );

    const inconsistentCheckpoints = buildInconsistentCheckpoints(entries);
    const verdictInconsistent = isVerdictInconsistent(runs);
    const checkpointInconsistent = inconsistentCheckpoints.length > 0;

    if (!verdictInconsistent && !checkpointInconsistent) continue;

    const filePaths = [...new Set(entries.map((e) => e.result.filePath))];
    const filePathWarnings =
      filePaths.length > 1
        ? [
            `Scenario "${scenario}" uses different file paths across runs: ${filePaths.join(", ")}`,
          ]
        : [];

    const failEntries = entries.filter(
      (e) =>
        (e.result.status === "fail" || e.result.status === "error") &&
        !isInfraError(e.result),
    );

    const passCount = runs.filter(
      (r) => r.status === "pass" && !r.errorIntermittent,
    ).length;
    const failCount = runs.filter((r) => r.status === "fail").length;
    const errorCount = runs.filter(
      (r) => r.status === "error" && !r.errorIntermittent,
    ).length;

    findings.push({
      scenario,
      filePath: filePaths[0]!,
      filePathWarnings,
      runCount: runs.length,
      passCount,
      failCount,
      errorCount,
      inconsistentCheckpoints,
      runs,
      heuristicAssessment: buildHeuristicAssessment(
        runs,
        inconsistentCheckpoints,
        failEntries,
        cwd,
      ),
    });
  }

  findings.sort((a, b) => {
    const aFlips = a.failCount + a.errorCount;
    const bFlips = b.failCount + b.errorCount;
    return bFlips - aFlips || b.passCount - a.passCount;
  });

  return {
    runIds,
    analyzedAt: new Date().toISOString(),
    findings,
  };
}

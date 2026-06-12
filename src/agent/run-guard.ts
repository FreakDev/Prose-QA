import { resolveAgentGuardConfig } from "../config/load.js";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { AgentTranscript, BashEntry, ParsedVerdict } from "../types/verdict.js";
import { getTranscriptBashEntries } from "./verdict.js";

export type RunGuardLevel = "ok" | "nudge" | "abort";

export interface RunGuardMetadata {
  guardNudgeSent?: boolean;
  guardFailedCount?: number;
}

export class RunGuardSyntheticFailError extends Error {
  override name = "RunGuardSyntheticFailError";
  readonly verdict: ParsedVerdict;

  constructor(verdict: ParsedVerdict) {
    super(
      `Run guard: ${verdict.summary}`,
    );
    this.verdict = verdict;
  }
}

export function isAgentBrowserFailure(entry: BashEntry): boolean {
  return entry.command.includes("agent-browser") && entry.exitCode !== 0;
}

export function countFailedAgentBrowserCalls(
  transcript: AgentTranscript,
  currentEntry?: BashEntry,
): number {
  let count = getTranscriptBashEntries(transcript).filter(isAgentBrowserFailure).length;
  if (currentEntry && isAgentBrowserFailure(currentEntry)) {
    count += 1;
  }
  return count;
}

export function isRunGuardEnabled(config: PqaConfig): boolean {
  const guard = resolveAgentGuardConfig(config);
  return guard.maxFailedToolCalls > 0 || guard.nudgeFailedToolCalls > 0;
}

export function evaluateRunGuard(options: {
  transcript: AgentTranscript;
  config: PqaConfig;
  metadata: RunGuardMetadata;
  currentEntry?: BashEntry;
}): { level: RunGuardLevel; failedCount: number } {
  const guard = resolveAgentGuardConfig(options.config);
  const failedCount = countFailedAgentBrowserCalls(
    options.transcript,
    options.currentEntry,
  );
  options.metadata.guardFailedCount = failedCount;

  if (guard.maxFailedToolCalls > 0 && failedCount >= guard.maxFailedToolCalls) {
    return { level: "abort", failedCount };
  }

  if (
    guard.nudgeFailedToolCalls > 0 &&
    failedCount >= guard.nudgeFailedToolCalls &&
    !options.metadata.guardNudgeSent
  ) {
    return { level: "nudge", failedCount };
  }

  return { level: "ok", failedCount };
}

export function buildGuardNudgeMessage(
  failedCount: number,
  maxFailedToolCalls: number,
): string {
  return `## Run guard nudge

${failedCount} agent-browser command(s) have failed so far in this scenario.

If the Steps cannot advance after repeated failures, do not loop indefinitely. Capture artifacts to \`$PQA_ARTIFACT_DIR\`, then emit a \`fail\` verdict with CLI evidence for every Then checkpoint.

The harness will stop this run automatically after ${maxFailedToolCalls} failed agent-browser calls if you do not conclude first.`;
}

function recentFailedBashEvidence(
  transcript: AgentTranscript,
  limit = 3,
): string[] {
  return getTranscriptBashEntries(transcript)
    .filter(isAgentBrowserFailure)
    .slice(-limit)
    .map((entry) => {
      const detail = (entry.stderr || entry.stdout).trim().slice(0, 120);
      return `${entry.command} (exit ${entry.exitCode})${detail ? `: ${detail}` : ""}`;
    });
}

export function buildSyntheticGuardVerdict(
  scenario: Scenario,
  failedCount: number,
  maxFailedToolCalls: number,
  transcript: AgentTranscript,
): ParsedVerdict {
  const evidence = recentFailedBashEvidence(transcript);
  const summary =
    `Harness run guard stopped this scenario after ${failedCount} failed agent-browser ` +
    `calls (limit: ${maxFailedToolCalls}). Steps could not be completed reliably.`;

  return {
    status: "fail",
    summary,
    checkpoints: scenario.then.map((assertion) => ({
      assertion,
      pass: false,
      reason:
        `Scenario stopped by run guard after ${failedCount} failed agent-browser calls ` +
        `(limit: ${maxFailedToolCalls}).`,
      evidence: evidence.length > 0 ? [...evidence] : undefined,
    })),
  };
}

export function assertNoRunGuard(options: {
  transcript: AgentTranscript;
  config: PqaConfig;
  metadata: RunGuardMetadata;
  scenario: Scenario;
}): void {
  if (!isRunGuardEnabled(options.config)) return;

  const evaluation = evaluateRunGuard(options);
  if (evaluation.level !== "abort") return;

  const guard = resolveAgentGuardConfig(options.config);
  throw new RunGuardSyntheticFailError(
    buildSyntheticGuardVerdict(
      options.scenario,
      evaluation.failedCount,
      guard.maxFailedToolCalls,
      options.transcript,
    ),
  );
}

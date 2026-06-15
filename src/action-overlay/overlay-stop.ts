import type { Scenario } from "../types/scenario.js";
import type { AgentTranscript, ParsedVerdict } from "../types/verdict.js";

export class OverlayStopSyntheticFailError extends Error {
  override name = "OverlayStopSyntheticFailError";
  readonly verdict: ParsedVerdict;

  constructor(verdict: ParsedVerdict) {
    super(`Overlay stop: ${verdict.summary}`);
    this.verdict = verdict;
  }
}

export function isOverlayStopSyntheticFailError(
  err: unknown,
): err is OverlayStopSyntheticFailError {
  if (err instanceof OverlayStopSyntheticFailError) return true;
  if (!(err instanceof Error) || err.name !== "OverlayStopSyntheticFailError") {
    return false;
  }
  const verdict = (err as OverlayStopSyntheticFailError).verdict;
  return (
    typeof verdict === "object" &&
    verdict !== null &&
    verdict.status === "fail" &&
    Array.isArray(verdict.checkpoints)
  );
}

export function buildSyntheticOverlayStopVerdict(
  scenario: Scenario,
): ParsedVerdict {
  const summary = "Stopped from action overlay before the scenario could be verified.";
  return {
    status: "fail",
    summary,
    checkpoints: scenario.then.map((assertion) => ({
      assertion,
      pass: false,
      reason: "Scenario stopped from the action overlay HUD.",
    })),
  };
}

export function assertNotOverlayStopped(
  stopped: boolean,
  scenario: Scenario,
): void {
  if (!stopped) return;
  throw new OverlayStopSyntheticFailError(
    buildSyntheticOverlayStopVerdict(scenario),
  );
}

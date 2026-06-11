import { resolveHealingConfig } from "../config/load.js";
import { getTranscriptBashEntries, getTranscriptMessages } from "../agent/verdict.js";
import type { PqaConfig } from "../types/config.js";
import type { Scenario, ParsedCheckpoint } from "../types/scenario.js";
import type { ScenarioResult, FailureKind, Verdict } from "../types/verdict.js";

export type { FailureKind };

export interface ClassifiedFailure {
  kind: FailureKind;
  confidence: "high" | "medium" | "low";
  signals: string[];
  failedCheckpoints: string[];
}

const STEPS_COMPLETED_RE =
  /all \d+ steps|steps completed|step \d+ done|steps completed successfully/i;

const END_STATE_MISMATCH_RE =
  /after completing|current page|no longer|detail page|replaced|not present on|final state|end state|navigating to a project/i;

const PRODUCT_STATE_RE =
  /disabled|blocked|incomplete|before adding|must complete|cannot add|not allowed|error message|validation error|complete the client/i;

function failedCheckpointResults(verdict: Verdict | null) {
  return verdict?.checkpoints.filter((c) => !c.pass) ?? [];
}

function checkpointKindForAssertion(
  scenario: Scenario | undefined,
  assertion: string,
): ParsedCheckpoint["kind"] {
  const match = scenario?.checkpoints.find((c) => c.raw === assertion);
  return match?.kind ?? "unknown";
}

function matchesPatterns(text: string, patterns: string[]): string[] {
  const lower = text.toLowerCase();
  return patterns.filter((p) => {
    try {
      return new RegExp(p, "i").test(lower);
    } catch {
      return lower.includes(p.toLowerCase());
    }
  });
}

function collectTransientSignals(
  result: ScenarioResult,
  patterns: string[],
): string[] {
  const hits = new Set<string>();

  for (const entry of getTranscriptBashEntries(result.transcript)) {
    if (!entry.command.includes("agent-browser")) continue;
    const blob = `${entry.stdout}\n${entry.stderr}`;
    const matched = matchesPatterns(blob, patterns);
    if (entry.exitCode !== 0 && matched.length > 0) {
      for (const m of matched) hits.add(`bash:${m}`);
    }
    if (matched.length > 0 && entry.exitCode !== 0) {
      hits.add(`bash-exit-${entry.exitCode}`);
    }
  }

  for (const cp of failedCheckpointResults(result.verdict)) {
    for (const m of matchesPatterns(cp.reason, patterns)) {
      hits.add(`reason:${m}`);
    }
  }

  if (result.error) {
    for (const m of matchesPatterns(result.error, patterns)) {
      hits.add(`error:${m}`);
    }
  }

  return [...hits];
}

function stepsCompletedSignal(result: ScenarioResult): boolean {
  const summary = result.verdict?.summary ?? "";
  if (STEPS_COMPLETED_RE.test(summary)) return true;
  for (const msg of getTranscriptMessages(result.transcript)) {
    if (STEPS_COMPLETED_RE.test(msg.content)) return true;
  }
  return false;
}

function isScenarioIssue(
  result: ScenarioResult,
  scenario: Scenario | undefined,
): { match: boolean; signals: string[] } {
  const failed = failedCheckpointResults(result.verdict);
  if (failed.length === 0) return { match: false, signals: [] };

  if (!stepsCompletedSignal(result)) {
    return { match: false, signals: [] };
  }

  const signals: string[] = ["steps_completed"];
  let hasStructuralFail = false;

  for (const cp of failed) {
    const kind = checkpointKindForAssertion(scenario, cp.assertion);
    if (kind !== "page_shows" && kind !== "url_contains") continue;

    if (END_STATE_MISMATCH_RE.test(cp.reason)) {
      signals.push(`end_state_mismatch:${cp.assertion}`);
      hasStructuralFail = true;
    } else if (kind === "page_shows" && stepsCompletedSignal(result)) {
      signals.push(`page_shows_after_navigation:${cp.assertion}`);
      hasStructuralFail = true;
    }
  }

  return { match: hasStructuralFail, signals };
}

function isProductFailure(result: ScenarioResult): { match: boolean; signals: string[] } {
  const failed = failedCheckpointResults(result.verdict);
  const signals: string[] = [];

  for (const cp of failed) {
    if (PRODUCT_STATE_RE.test(cp.reason)) {
      signals.push(`product_reason:${cp.assertion}`);
    }
    if (/equals/i.test(cp.assertion) || cp.assertion.includes(" = ")) {
      signals.push(`semantic_checkpoint:${cp.assertion}`);
    }
  }

  const semanticOnly =
    failed.length > 0 &&
    failed.every((cp) => {
      const text = cp.assertion;
      return !/^url contains/i.test(text) && !/^page shows/i.test(text);
    });

  if (semanticOnly && failed.some((cp) => PRODUCT_STATE_RE.test(cp.reason))) {
    return { match: true, signals };
  }

  if (signals.some((s) => s.startsWith("product_reason"))) {
    return { match: true, signals };
  }

  if (
    failed.length > 0 &&
    failed.every((cp) => !/^url contains/i.test(cp.assertion) && !/^page shows/i.test(cp.assertion)) &&
    failed.some((cp) => PRODUCT_STATE_RE.test(cp.reason))
  ) {
    return { match: true, signals };
  }

  return { match: signals.length > 0, signals };
}

const MINIMAL_CONFIG: PqaConfig = {
  llm: { provider: "anthropic", model: "default" },
  browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 30, bashTimeoutMs: 120_000 },
};

export function classifyFailure(
  result: ScenarioResult,
  scenario?: Scenario,
  config?: PqaConfig,
): ClassifiedFailure {
  const healing = resolveHealingConfig(config ?? MINIMAL_CONFIG);
  const failedCheckpoints = failedCheckpointResults(result.verdict).map(
    (c) => c.assertion,
  );

  if (result.status === "error") {
    const transientSignals = collectTransientSignals(result, healing.transientPatterns);
    if (transientSignals.length > 0) {
      return {
        kind: "transient",
        confidence: "medium",
        signals: transientSignals,
        failedCheckpoints,
      };
    }
    return {
      kind: "unknown",
      confidence: "low",
      signals: result.error ? [`error:${result.error.slice(0, 80)}`] : [],
      failedCheckpoints,
    };
  }

  if (result.status !== "fail" || !result.verdict) {
    return {
      kind: "unknown",
      confidence: "low",
      signals: [],
      failedCheckpoints,
    };
  }

  const scenarioIssue = isScenarioIssue(result, scenario);
  if (scenarioIssue.match) {
    return {
      kind: "scenario_issue",
      confidence: "high",
      signals: scenarioIssue.signals,
      failedCheckpoints,
    };
  }

  const product = isProductFailure(result);
  if (product.match) {
    return {
      kind: "product",
      confidence: "medium",
      signals: product.signals,
      failedCheckpoints,
    };
  }

  const transientSignals = collectTransientSignals(result, healing.transientPatterns);
  if (transientSignals.length > 0) {
    return {
      kind: "transient",
      confidence: "medium",
      signals: transientSignals,
      failedCheckpoints,
    };
  }

  return {
    kind: "unknown",
    confidence: "low",
    signals: [],
    failedCheckpoints,
  };
}

export function isHealingEnabled(
  config: PqaConfig,
  noHealing?: boolean,
): boolean {
  if (noHealing) return false;
  return resolveHealingConfig(config).enabled;
}

export function isRecoveryAllowed(
  classified: ClassifiedFailure,
  config: PqaConfig,
  noHealing?: boolean,
): boolean {
  if (!isHealingEnabled(config, noHealing)) return false;
  if (classified.failedCheckpoints.length === 0) return false;

  const healing = resolveHealingConfig(config);

  if (classified.kind === "transient") return true;
  if (classified.kind === "unknown" && healing.recoverOnUnknown) {
    return classified.signals.some((s) => s.startsWith("bash:"));
  }
  return false;
}

export function isScenarioRetryAllowed(
  classified: ClassifiedFailure,
  retriesPolicy: "transient" | "always" | undefined,
  config: PqaConfig,
  noHealing?: boolean,
): boolean {
  if (retriesPolicy === "always") return true;
  if (!isHealingEnabled(config, noHealing)) {
    return true;
  }
  return classified.kind === "transient";
}

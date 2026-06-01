import type { Scenario } from "../types/scenario.js";
import type { ScenarioResult } from "../types/verdict.js";

export const FAIL_FAST_SKIP_REASON =
  "Not run (--fail-fast stopped the run)";

export function emptyTranscript(): ScenarioResult["transcript"] {
  return { entries: [] };
}

export function createSkippedScenarioResult(
  scenario: Scenario,
  reason: string = FAIL_FAST_SKIP_REASON,
): ScenarioResult {
  return {
    scenario: scenario.frontmatter.name,
    filePath: scenario.filePath,
    status: "skipped",
    durationMs: 0,
    verdict: null,
    transcript: emptyTranscript(),
    error: reason,
  };
}

/** Fill holes left when parallel fail-fast stops scheduling new work. */
export function alignScenarioResults(
  scenarios: Scenario[],
  results: (ScenarioResult | undefined)[],
): ScenarioResult[] {
  return scenarios.map((scenario, index) => {
    const result = results[index];
    if (result !== undefined) {
      return result;
    }
    return createSkippedScenarioResult(scenario);
  });
}

/**
 * Run `fn` over `items` with at most `limit` in-flight tasks at once.
 * When a task finishes, the next item is started immediately on that slot
 * (worker pool), not in fixed batches of `limit`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options?: {
    failFast?: boolean;
    isFailure?: (result: R) => boolean;
  },
): Promise<(R | undefined)[]> {
  if (items.length === 0) return [];

  const concurrency = Number.isFinite(limit)
    ? Math.min(limit, items.length)
    : items.length;
  const results: (R | undefined)[] = new Array(items.length);
  const pendingIndices = Array.from({ length: items.length }, (_, i) => i);
  let stopScheduling = false;

  async function worker(): Promise<void> {
    while (true) {
      if (options?.failFast && stopScheduling) return;
      const index = pendingIndices.shift();
      if (index === undefined) return;
      results[index] = await fn(items[index]!, index);
      if (options?.failFast && options.isFailure?.(results[index]!)) {
        stopScheduling = true;
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );
  return results;
}

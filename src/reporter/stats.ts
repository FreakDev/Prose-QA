import type {
  ScenarioResult,
  TokenUsageStats,
  VerdictStats,
} from "../types/verdict.js";
import {
  computeTranscriptStats,
  enrichVerdictWithStats,
} from "../agent/verdict.js";

export interface RunStats {
  scenarios: Record<string, VerdictStats>;
  global: VerdictStats;
}

export function scenarioSlug(scenarioName: string): string {
  return scenarioName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export function resolveScenarioStats(result: ScenarioResult): VerdictStats {
  if (result.verdict) {
    const enriched = enrichVerdictWithStats(result.verdict, result.transcript, {
      durationMs: result.durationMs,
      healing: result.healing,
      tokens: result.verdict.stats?.tokens,
    });
    return enriched!.stats!;
  }

  return computeTranscriptStats(result.transcript, {
    durationMs: result.durationMs,
    healing: result.healing,
  });
}

export function aggregateVerdictStats(statsList: VerdictStats[]): VerdictStats {
  const aggregated: VerdictStats = {
    durationMs: 0,
    llmTurns: 0,
    userTurns: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    llmDurationMs: 0,
    bashDurationMs: 0,
  };

  let tokens: TokenUsageStats | undefined;
  let healingUsed = false;
  let recoveryTurns = 0;
  let scenarioRetries = 0;
  let hasHealing = false;

  for (const stats of statsList) {
    aggregated.durationMs += stats.durationMs;
    aggregated.llmTurns += stats.llmTurns;
    aggregated.userTurns += stats.userTurns;
    aggregated.toolCalls += stats.toolCalls;
    aggregated.failedToolCalls += stats.failedToolCalls;
    aggregated.llmDurationMs += stats.llmDurationMs;
    aggregated.bashDurationMs += stats.bashDurationMs;

    if (stats.tokens) {
      tokens ??= { input: 0, output: 0, cached: 0 };
      tokens.input += stats.tokens.input;
      tokens.output += stats.tokens.output;
      tokens.cached = (tokens.cached ?? 0) + (stats.tokens.cached ?? 0);
    }

    if (stats.healing) {
      hasHealing = true;
      healingUsed = healingUsed || stats.healing.used;
      recoveryTurns += stats.healing.recoveryTurns;
      scenarioRetries += stats.healing.scenarioRetries;
    }
  }

  if (
    tokens &&
    (tokens.input > 0 || tokens.output > 0 || (tokens.cached ?? 0) > 0)
  ) {
    aggregated.tokens = {
      input: tokens.input,
      output: tokens.output,
      ...((tokens.cached ?? 0) > 0 ? { cached: tokens.cached } : {}),
    };
  }

  if (hasHealing) {
    aggregated.healing = {
      used: healingUsed,
      recoveryTurns,
      scenarioRetries,
    };
  }

  return aggregated;
}

export function buildRunStats(results: ScenarioResult[]): RunStats {
  const scenarios: Record<string, VerdictStats> = {};
  const allStats: VerdictStats[] = [];

  for (const result of results) {
    const stats = resolveScenarioStats(result);
    scenarios[scenarioSlug(result.scenario)] = stats;
    allStats.push(stats);
  }

  return {
    scenarios,
    global: aggregateVerdictStats(allStats),
  };
}

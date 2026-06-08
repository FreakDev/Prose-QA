import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScenarioResult, VerdictStats } from "../types/verdict.js";
import {
  aggregateVerdictStats,
  buildRunStats,
  resolveScenarioStats,
  scenarioSlug,
} from "./stats.js";

function stubStats(overrides: Partial<VerdictStats> = {}): VerdictStats {
  return {
    durationMs: 1000,
    llmTurns: 2,
    userTurns: 1,
    toolCalls: 3,
    failedToolCalls: 0,
    llmDurationMs: 800,
    bashDurationMs: 200,
    ...overrides,
  };
}

function stubResult(
  scenario: string,
  overrides: Partial<ScenarioResult> = {},
): ScenarioResult {
  return {
    scenario,
    filePath: `scenarios/${scenario}.md`,
    status: "pass",
    durationMs: 12_750,
    verdict: {
      status: "pass",
      checkpoints: [],
      summary: "ok",
      stats: {
        durationMs: 12_750,
        llmTurns: 1,
        userTurns: 1,
        toolCalls: 1,
        failedToolCalls: 0,
        llmDurationMs: 5000,
        bashDurationMs: 200,
        tokens: { input: 100, output: 10, cached: 5 },
      },
    },
    transcript: {
      entries: [
        {
          type: "message",
          role: "user",
          content: "go",
          at: "2026-01-01T00:00:00.000Z",
        },
        {
          type: "message",
          role: "assistant",
          content: "done",
          at: "2026-01-01T00:00:05.000Z",
          durationMs: 5000,
        },
        {
          type: "bash",
          command: "agent-browser snapshot -i",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 200,
          at: "2026-01-01T00:00:05.000Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("scenarioSlug", () => {
  it("normalizes scenario names like artifact directories", () => {
    assert.equal(scenarioSlug("VS QA Use"), "vs-qa-use");
    assert.equal(scenarioSlug("hello_world"), "hello-world");
  });
});

describe("resolveScenarioStats", () => {
  it("returns enriched verdict stats when a verdict exists", () => {
    const stats = resolveScenarioStats(stubResult("demo"));
    assert.equal(stats.durationMs, 12_750);
    assert.equal(stats.llmTurns, 1);
    assert.deepEqual(stats.tokens, { input: 100, output: 10, cached: 5 });
  });

  it("computes transcript stats when there is no verdict", () => {
    const stats = resolveScenarioStats(
      stubResult("demo", {
        verdict: null,
        durationMs: 5200,
      }),
    );
    assert.equal(stats.durationMs, 5200);
    assert.equal(stats.llmTurns, 1);
    assert.equal(stats.toolCalls, 1);
    assert.equal(stats.bashDurationMs, 200);
  });
});

describe("aggregateVerdictStats", () => {
  it("sums numeric counters and token usage", () => {
    const global = aggregateVerdictStats([
      stubStats({
        durationMs: 1000,
        llmTurns: 2,
        tokens: { input: 100, output: 10, cached: 5 },
        healing: { used: false, recoveryTurns: 1, scenarioRetries: 0 },
      }),
      stubStats({
        durationMs: 2000,
        llmTurns: 3,
        tokens: { input: 50, output: 20 },
        healing: { used: true, recoveryTurns: 2, scenarioRetries: 1 },
      }),
    ]);

    assert.equal(global.durationMs, 3000);
    assert.equal(global.llmTurns, 5);
    assert.deepEqual(global.tokens, { input: 150, output: 30, cached: 5 });
    assert.deepEqual(global.healing, {
      used: true,
      recoveryTurns: 3,
      scenarioRetries: 1,
    });
  });
});

describe("buildRunStats", () => {
  it("builds per-scenario stats and a global aggregate", () => {
    const stats = buildRunStats([
      stubResult("Alpha Smoke", {
        durationMs: 1000,
        verdict: {
          status: "pass",
          checkpoints: [],
          summary: "ok",
          stats: stubStats({
            durationMs: 1000,
            llmTurns: 1,
            tokens: { input: 10, output: 1 },
          }),
        },
      }),
      stubResult("Beta Flow", {
        durationMs: 2000,
        verdict: {
          status: "fail",
          checkpoints: [],
          summary: "nope",
          stats: stubStats({
            durationMs: 2000,
            llmTurns: 2,
            tokens: { input: 20, output: 2 },
          }),
        },
      }),
    ]);

    assert.deepEqual(Object.keys(stats.scenarios).sort(), [
      "alpha-smoke",
      "beta-flow",
    ]);
    assert.equal(stats.scenarios["alpha-smoke"]!.durationMs, 1000);
    assert.equal(stats.scenarios["beta-flow"]!.llmTurns, 1);
    assert.equal(stats.global.durationMs, 3000);
    assert.equal(stats.global.llmTurns, 2);
    assert.deepEqual(stats.global.tokens, { input: 30, output: 3 });
  });
});

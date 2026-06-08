import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Scenario } from "../types/scenario.js";
import {
  FAIL_FAST_SKIP_REASON,
  alignScenarioResults,
  mapWithConcurrency,
} from "./concurrency.js";

function stubScenario(name: string): Scenario {
  return {
    filePath: `scenarios/${name}.md`,
    frontmatter: { name, tags: [], url: "http://localhost" },
    goal: "",
    steps: "",
    then: [],
    rawCheckpoints: [],
    checkpoints: [],
    skills: [],
  };
}

describe("mapWithConcurrency fail-fast", () => {
  it("leaves undefined slots for work never scheduled", async () => {
    const results = await mapWithConcurrency(
      [0, 1, 2, 3],
      1,
      async (item) => {
        if (item === 0) return "fail";
        return "pass";
      },
      {
        failFast: true,
        isFailure: (r) => r === "fail",
      },
    );

    assert.equal(results[0], "fail");
    assert.equal(results[1], undefined);
    assert.equal(results[2], undefined);
    assert.equal(results[3], undefined);
  });
});

describe("alignScenarioResults", () => {
  it("replaces undefined slots with skipped scenario results", () => {
    const scenarios = [
      stubScenario("alpha"),
      stubScenario("beta"),
      stubScenario("gamma"),
    ];
    const aligned = alignScenarioResults(scenarios, [
      {
        scenario: "alpha",
        filePath: scenarios[0]!.filePath,
        status: "fail",
        durationMs: 1,
        verdict: null,
        transcript: { entries: [] },
      },
      undefined,
      undefined,
    ]);

    assert.equal(aligned.length, 3);
    assert.equal(aligned[0]!.status, "fail");
    assert.equal(aligned[1]!.status, "skipped");
    assert.equal(aligned[2]!.status, "skipped");
    assert.equal(aligned[1]!.error, FAIL_FAST_SKIP_REASON);
    assert.equal(aligned[1]!.scenario, "beta");
  });
});

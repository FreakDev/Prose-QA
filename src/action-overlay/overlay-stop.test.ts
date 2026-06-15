import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Scenario } from "../types/scenario.js";
import {
  buildSyntheticOverlayStopVerdict,
  isOverlayStopSyntheticFailError,
  OverlayStopSyntheticFailError,
} from "./overlay-stop.js";

const scenario: Scenario = {
  frontmatter: { name: "demo", url: "http://example.test" },
  filePath: "scenarios/demo.md",
  skills: [],
  goal: "demo goal",
  steps: "1. Do thing",
  then: ["page loads"],
  rawCheckpoints: ["page loads"],
  checkpoints: [{ kind: "semantic", raw: "page loads" }],
};

describe("overlay stop verdict", () => {
  it("builds a synthetic fail verdict for every Then checkpoint", () => {
    const verdict = buildSyntheticOverlayStopVerdict(scenario);
    assert.equal(verdict.status, "fail");
    assert.equal(verdict.checkpoints.length, 1);
    assert.equal(verdict.checkpoints[0]?.pass, false);
  });

  it("recognizes OverlayStopSyntheticFailError", () => {
    const err = new OverlayStopSyntheticFailError(
      buildSyntheticOverlayStopVerdict(scenario),
    );
    assert.equal(isOverlayStopSyntheticFailError(err), true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Scenario } from "../types/scenario.js";
import { buildVerdictRetryPrompt } from "./verdict-retry-prompt.js";

const baseScenario: Scenario = {
  filePath: "scenarios/test.md",
  frontmatter: { name: "test" },
  skills: [],
  goal: "Test goal",
  steps: "1. Do thing",
  then: ['url contains "/home"', 'page shows "Welcome"'],
  rawCheckpoints: [],
  checkpoints: [],
};

describe("buildVerdictRetryPrompt", () => {
  it("lists every Then checkpoint and requires JSON verdict", () => {
    const prompt = buildVerdictRetryPrompt(baseScenario);

    assert.match(prompt, /## Verdict required/);
    assert.match(prompt, /2 total/);
    assert.match(prompt, /\*\*url contains "\/home"\*\*/);
    assert.match(prompt, /\*\*page shows "Welcome"\*\*/);
    assert.match(prompt, /fenced ```json block/i);
    assert.match(prompt, /Do \*\*not\*\* use bash or read tools/);
  });
});

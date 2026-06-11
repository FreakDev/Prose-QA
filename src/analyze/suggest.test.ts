import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyFailure } from "../healing/classify.js";
import type { Scenario } from "../types/scenario.js";
import type { ScenarioResult } from "../types/verdict.js";
import { suggestScenarioFixes } from "./suggest.js";

const scenario: Scenario = {
  filePath: "/scenarios/pilar-smoke.md",
  frontmatter: { name: "pilar-smoke" },
  skills: [],
  goal: "Smoke",
  steps: `1. Open app
4. Click My projects
5. Open the first project`,
  then: ['url contains "/projects"', 'page shows "Projects"'],
  rawCheckpoints: [],
  checkpoints: [
    { raw: 'url contains "/projects"', kind: "url_contains", value: "/projects" },
    { raw: 'page shows "Projects"', kind: "page_shows", value: "Projects" },
  ],
};

const failResult: ScenarioResult = {
  scenario: "pilar-smoke",
  filePath: "/scenarios/pilar-smoke.md",
  status: "fail",
  durationMs: 1,
  verdict: {
    status: "fail",
    summary: "All 5 steps completed successfully.",
    checkpoints: [
      { assertion: 'url contains "/projects"', pass: true, reason: "ok" },
      {
        assertion: 'page shows "Projects"',
        pass: false,
        reason: "After completing all steps, on project detail page.",
      },
    ],
  },
  transcript: { entries: [] },
};

describe("suggestScenarioFixes", () => {
  it("suggests moving page_shows checkpoint before navigation", () => {
    const classified = classifyFailure(failResult, scenario, {
      llm: { provider: "anthropic", model: "x" },
      browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
      skills: { dirs: [], preloads: [] },
      agent: { maxTurns: 30, bashTimeoutMs: 120_000 },
    });
    const suggestions = suggestScenarioFixes(failResult, scenario, classified);
    assert.equal(classified.kind, "scenario_issue");
    assert.ok(
      suggestions.some((s) => s.includes('page shows "Projects"') && s.includes("step 4")),
    );
  });
});

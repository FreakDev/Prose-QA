import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiffHunks } from "./diff-hunks.js";
import { formatFlakySummary, formatHeuristicSummary } from "./repl.js";
import type { FlakyAnalyzeReport } from "./compare-runs.js";

describe("formatHeuristicSummary", () => {
  it("reports when all scenarios passed", () => {
    const text = formatHeuristicSummary({
      runId: "run-1",
      analyzedAt: "now",
      findings: [],
    });
    assert.match(text, /all scenarios passed/i);
  });

  it("lists failed scenarios", () => {
    const text = formatHeuristicSummary({
      runId: "run-1",
      analyzedAt: "now",
      findings: [
        {
          scenario: "demo",
          filePath: "scenarios/demo.md",
          status: "fail",
          failureKind: "scenario_issue",
          confidence: "high",
          suggestions: ["Move checkpoint"],
          signals: ["steps_completed"],
        },
      ],
    });
    assert.match(text, /demo/);
    assert.match(text, /scenario_issue/);
  });
});

describe("formatFlakySummary", () => {
  it("reports when no flaky scenarios found", () => {
    const text = formatFlakySummary({
      runIds: ["a", "b"],
      analyzedAt: "now",
      findings: [],
    });
    assert.match(text, /No flaky scenarios/i);
  });

  it("lists flaky scenario stats", () => {
    const report: FlakyAnalyzeReport = {
      runIds: ["a", "b", "c"],
      analyzedAt: "now",
      findings: [
        {
          scenario: "pilar-smoke",
          filePath: "scenarios/pilar-smoke.md",
          filePathWarnings: [],
          runCount: 3,
          passCount: 2,
          failCount: 1,
          errorCount: 0,
          inconsistentCheckpoints: [
            {
              assertion: 'page shows "Projects"',
              passedIn: ["a", "b"],
              failedIn: ["c"],
            },
          ],
          runs: [],
          heuristicAssessment: {
            dominantKind: "scenario_issue",
            likelyFalseNegative: true,
            likelyFalsePositive: false,
            suggestions: [],
          },
        },
      ],
    };
    const text = formatFlakySummary(report);
    assert.match(text, /pilar-smoke/);
    assert.match(text, /2 pass \/ 1 fail/);
    assert.match(text, /checkpoint flip/i);
    assert.match(text, /false negative/i);
  });
});

describe("computeDiffHunks integration", () => {
  it("produces hunks for scenario-like edits", () => {
    const before = `# Steps
1. Open app
2. Click Save

# Then
- page shows "Done"
`;
    const after = `# Steps
1. Open app
2. Click Save
3. Wait for confirmation

# Then
- page shows "Done"
`;
    const hunks = computeDiffHunks(before, after);
    assert.ok(hunks.length >= 1);
  });
});

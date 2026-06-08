import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiffHunks } from "./diff-hunks.js";
import { formatHeuristicSummary } from "./repl.js";

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

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildFlakyAnalyzeContext,
  buildScenarioIntent,
} from "./build-context.js";
import type { FlakyScenarioFinding } from "./compare-runs.js";
import type { RunReport, ScenarioResult } from "../types/verdict.js";
import { mkdirSync } from "node:fs";

describe("buildScenarioIntent", () => {
  it("extracts goal, steps, and then from a scenario file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-intent-"));
    const file = path.join(dir, "demo.md");
    writeFileSync(
      file,
      `---
name: demo-flow
url: http://localhost:3000/invoices
tags: [smoke]
---

# Goal
Verify invoice status can be changed.

# Steps
1. Open the first invoice.
2. Change status to Paid.

# Then
- page shows "Paid"
`,
      "utf-8",
    );

    const intent = buildScenarioIntent(file);
    assert.ok(intent);
    assert.equal(intent!.name, "demo-flow");
    assert.match(intent!.goal, /invoice status/i);
    assert.match(intent!.steps, /Open the first invoice/);
    assert.deepEqual(intent!.then, ['page shows "Paid"']);
  });
});

describe("buildFlakyAnalyzeContext", () => {
  it("includes pass and fail representative runs", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-flaky-ctx-"));
    const scenarioPath = path.join(cwd, "scenarios", "demo.md");
    mkdirSync(path.dirname(scenarioPath), { recursive: true });
    writeFileSync(
      scenarioPath,
      `---
name: demo
---

# Goal
Verify demo.

# Steps
1. Open app.

# Then
- page shows "OK"
`,
    );

    const makeResult = (status: "pass" | "fail", runId: string): ScenarioResult => ({
      scenario: "demo",
      filePath: "scenarios/demo.md",
      status,
      durationMs: 1000,
      verdict: {
        status: status === "pass" ? "pass" : "fail",
        summary: status,
        checkpoints: [
          {
            assertion: 'page shows "OK"',
            pass: status === "pass",
            reason: status,
          },
        ],
      },
      transcript: { entries: [] },
    });

    const writeRun = (runId: string, result: ScenarioResult): string => {
      const runDir = path.join(cwd, ".pqa", "runs", runId);
      mkdirSync(runDir, { recursive: true });
      const report: RunReport = {
        runId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        results: [result],
        summary: { total: 1, passed: 0, failed: 0, errors: 0, skipped: 0 },
      };
      writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report));
      return runDir;
    };

    const runPass = writeRun("run-pass", makeResult("pass", "run-pass"));
    const runFail = writeRun("run-fail", makeResult("fail", "run-fail"));

    const finding: FlakyScenarioFinding = {
      scenario: "demo",
      filePath: "scenarios/demo.md",
      filePathWarnings: [],
      runCount: 2,
      passCount: 1,
      failCount: 1,
      errorCount: 0,
      inconsistentCheckpoints: [
        {
          assertion: 'page shows "OK"',
          passedIn: ["run-pass"],
          failedIn: ["run-fail"],
        },
      ],
      runs: [],
      heuristicAssessment: {
        dominantKind: "scenario_issue",
        likelyFalseNegative: true,
        likelyFalsePositive: false,
        suggestions: [],
      },
    };

    const context = buildFlakyAnalyzeContext(finding, [runPass, runFail], cwd);
    assert.ok(context.runComparison.representativeRuns.pass);
    assert.ok(context.runComparison.representativeRuns.fail);
    assert.equal(context.runComparison.stats.pass, 1);
    assert.equal(context.runComparison.stats.fail, 1);
    assert.match(context.scenarioMarkdown, /# Goal/);
  });
});

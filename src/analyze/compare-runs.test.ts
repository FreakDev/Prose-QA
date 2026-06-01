import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { RunReport, ScenarioResult } from "../types/verdict.js";
import { compareRuns, selectRepresentativeRuns } from "./compare-runs.js";

function minimalResult(
  overrides: Partial<ScenarioResult> & Pick<ScenarioResult, "scenario" | "status">,
): ScenarioResult {
  return {
    filePath: "scenarios/demo.md",
    durationMs: 10_000,
    verdict: {
      status: overrides.status === "pass" ? "pass" : "fail",
      summary: "summary",
      checkpoints: [],
    },
    transcript: { entries: [] },
    ...overrides,
  };
}

function writeRun(cwd: string, runId: string, results: ScenarioResult[]): string {
  const runDir = path.join(cwd, ".pqa", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const report: RunReport = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
      errors: results.filter((r) => r.status === "error").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    },
  };
  writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report));
  return runDir;
}

describe("compareRuns", () => {
  it("detects pass/fail flip for the same scenario", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-compare-"));
    const runA = writeRun(cwd, "run-a", [
      minimalResult({ scenario: "demo", status: "pass" }),
    ]);
    const runB = writeRun(cwd, "run-b", [
      minimalResult({ scenario: "demo", status: "fail" }),
    ]);

    const report = compareRuns([runA, runB], cwd);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]!.scenario, "demo");
    assert.equal(report.findings[0]!.passCount, 1);
    assert.equal(report.findings[0]!.failCount, 1);
  });

  it("detects inconsistent checkpoints", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-compare-"));
    const runA = writeRun(cwd, "run-a", [
      minimalResult({
        scenario: "demo",
        status: "pass",
        verdict: {
          status: "pass",
          summary: "ok",
          checkpoints: [
            { assertion: 'page shows "Projects"', pass: true, reason: "found" },
          ],
        },
      }),
    ]);
    const runB = writeRun(cwd, "run-b", [
      minimalResult({
        scenario: "demo",
        status: "fail",
        verdict: {
          status: "fail",
          summary: "fail",
          checkpoints: [
            {
              assertion: 'page shows "Projects"',
              pass: false,
              reason: "not found",
            },
          ],
        },
      }),
    ]);

    const report = compareRuns([runA, runB], cwd);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]!.inconsistentCheckpoints.length, 1);
    assert.equal(
      report.findings[0]!.inconsistentCheckpoints[0]!.assertion,
      'page shows "Projects"',
    );
  });

  it("ignores always-pass scenarios", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-compare-"));
    const runA = writeRun(cwd, "run-a", [
      minimalResult({ scenario: "stable", status: "pass" }),
    ]);
    const runB = writeRun(cwd, "run-b", [
      minimalResult({ scenario: "stable", status: "pass" }),
    ]);

    const report = compareRuns([runA, runB], cwd);
    assert.equal(report.findings.length, 0);
  });

  it("tags short errors as intermittent and skips flaky flag when only infra errors flip", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-compare-"));
    const runA = writeRun(cwd, "run-a", [
      minimalResult({ scenario: "demo", status: "pass" }),
    ]);
    const runB = writeRun(cwd, "run-b", [
      minimalResult({
        scenario: "demo",
        status: "error",
        durationMs: 100,
        error: "browser crashed",
        verdict: null,
      }),
    ]);

    const report = compareRuns([runA, runB], cwd);
    assert.equal(report.findings.length, 0);
  });
});

describe("selectRepresentativeRuns", () => {
  it("picks most recent pass and fail by runId", () => {
    const pass = {
      runId: "run-z",
      result: minimalResult({ scenario: "demo", status: "pass" }),
    };
    const fail = {
      runId: "run-y",
      result: minimalResult({ scenario: "demo", status: "fail" }),
    };
    const olderPass = {
      runId: "run-a",
      result: minimalResult({ scenario: "demo", status: "pass" }),
    };

    const selected = selectRepresentativeRuns([olderPass, fail, pass]);
    assert.equal(selected.pass?.runId, "run-z");
    assert.equal(selected.fail?.runId, "run-y");
  });
});

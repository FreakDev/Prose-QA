import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  exportRunReportZip,
  finalizeRunReport,
  resolveReportOutputDestination,
  resolveRunDirectory,
} from "./export.js";
import { writeReport, buildReport } from "./index.js";

describe("resolveReportOutputDestination", () => {
  const cwd = "/project";
  const runId = "2026-06-03T12-00-00-000Z";

  it("creates a run directory inside a trailing-slash base path", () => {
    assert.equal(
      resolveReportOutputDestination("reports/", runId, false, cwd),
      path.join(cwd, "reports", runId),
    );
  });

  it("creates a zip file inside a trailing-slash base path", () => {
    assert.equal(
      resolveReportOutputDestination("reports/", runId, true, cwd),
      path.join(cwd, "reports", `${runId}.zip`),
    );
  });

  it("uses the full path as directory name when there is no trailing slash", () => {
    assert.equal(
      resolveReportOutputDestination("artifacts/my-run", runId, false, cwd),
      path.join(cwd, "artifacts", "my-run"),
    );
  });

  it("uses the full path as zip file name when there is no trailing slash", () => {
    assert.equal(
      resolveReportOutputDestination("artifacts/my-run.zip", runId, true, cwd),
      path.join(cwd, "artifacts", "my-run.zip"),
    );
  });
});

describe("resolveRunDirectory", () => {
  it("defaults to .pqa/runs when no output path is configured", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-run-dir-"));
    const runId = "test-run";
    const resolved = resolveRunDirectory(cwd, runId, { zip: false });
    assert.equal(resolved.runDir, path.join(cwd, ".pqa", "runs", runId));
    assert.equal(resolved.zipDestination, undefined);
  });

  it("writes directly to the resolved folder when zip is disabled", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-run-dir-"));
    const runId = "custom-run";
    const resolved = resolveRunDirectory(cwd, runId, {
      outputPath: "out/",
      zip: false,
    });
    assert.equal(resolved.runDir, path.join(cwd, "out", runId));
    assert.equal(resolved.zipDestination, undefined);
    assert.equal(statSync(resolved.runDir).isDirectory(), true);
  });

  it("keeps the internal run dir when zip export is requested", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-run-dir-"));
    const runId = "zip-run";
    const resolved = resolveRunDirectory(cwd, runId, {
      outputPath: "archives/",
      zip: true,
    });
    assert.equal(resolved.runDir, path.join(cwd, ".pqa", "runs", runId));
    assert.equal(
      resolved.zipDestination,
      path.join(cwd, "archives", `${runId}.zip`),
    );
  });
});

describe("finalizeRunReport", () => {
  it("creates a zip archive containing run artifacts", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-export-"));
    const runDir = path.join(cwd, "run");
    mkdirSync(runDir, { recursive: true });
    const zipPath = path.join(cwd, "report.zip");
    const report = buildReport("run-1", new Date(), []);
    writeReport(runDir, report);

    const result = finalizeRunReport(runDir, zipPath);
    assert.equal(result, zipPath);
    assert.equal(statSync(zipPath).isFile(), true);
    assert.ok(statSync(zipPath).size > 0);
  });

  it("returns report.html path for folder output", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-export-"));
    const runDir = path.join(cwd, "run");
    mkdirSync(runDir, { recursive: true });
    const report = buildReport("run-1", new Date(), []);
    writeReport(runDir, report);

    const result = finalizeRunReport(runDir);
    assert.equal(result, path.join(runDir, "report.html"));
    assert.equal(
      readFileSync(result, "utf-8").includes("PQA Run Report"),
      true,
    );
  });
});

describe("exportRunReportZip", () => {
  it("includes nested scenario artifact directories", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-export-nested-"));
    const runDir = path.join(cwd, "run");
    mkdirSync(runDir, { recursive: true });
    const scenarioDir = path.join(runDir, "hello-world");
    const zipPath = path.join(cwd, "nested.zip");
    const report = buildReport("run-1", new Date(), []);
    writeReport(runDir, report);
    mkdirSync(scenarioDir, { recursive: true });
    writeFileSync(path.join(scenarioDir, "transcript.json"), "{}\n");

    exportRunReportZip(runDir, zipPath);

    const extractDir = path.join(cwd, "extracted");
    mkdirSync(extractDir, { recursive: true });
    const result = spawnSync("tar", ["-xf", zipPath, "-C", extractDir], {
      encoding: "utf-8",
    });
    assert.equal(result.status, 0);
    assert.equal(
      readdirSync(path.join(extractDir, "hello-world")).includes(
        "transcript.json",
      ),
      true,
    );
  });
});

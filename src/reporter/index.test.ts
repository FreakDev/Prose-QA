import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createEnvRedactor } from "../redact/env-secrets.js";
import { buildReport, renderScenarioSummaryHtml, writeTranscript } from "./index.js";
import type { ScenarioResult } from "../types/verdict.js";

function stubResult(
  scenario: string,
  status: ScenarioResult["status"],
): ScenarioResult {
  return {
    scenario,
    filePath: `scenarios/${scenario}.md`,
    status,
    durationMs: 12_500,
    verdict: null,
    transcript: { entries: [] },
  };
}

describe("renderScenarioSummaryHtml", () => {
  it("lists each scenario with status and duration", () => {
    const report = buildReport("test-run", new Date(), [
      stubResult("alpha-smoke", "pass"),
      stubResult("beta-flow", "fail"),
    ]);
    const html = renderScenarioSummaryHtml(report.results);
    assert.match(html, /alpha-smoke/);
    assert.match(html, /beta-flow/);
    assert.match(html, />pass</);
    assert.match(html, />fail</);
    assert.match(html, /12\.5s/);
    assert.match(html, /class="scenario-summary"/);
  });

  it("returns empty string when there are no results", () => {
    assert.equal(renderScenarioSummaryHtml([]), "");
  });
});

describe("writeTranscript", () => {
  it("redacts sensitive env values when a redactor is provided", () => {
    const artifactDir = mkdtempSync(path.join(tmpdir(), "pqa-transcript-"));
    const redactor = createEnvRedactor({ API_KEY: "sk-live-secret" }, [
      "API_KEY",
    ]);
    writeTranscript(
      artifactDir,
      {
        entries: [
          { type: "message", role: "assistant", content: "used sk-live-secret here", at: "2026-01-01T00:00:00.000Z" },
          {
            type: "bash",
            command: "curl -H 'Authorization: sk-live-secret'",
            stdout: "ok",
            stderr: "",
            exitCode: 0,
            durationMs: 1,
            at: "2026-01-01T00:00:01.000Z",
          },
        ],
      },
      redactor,
    );
    const written = readFileSync(
      path.join(artifactDir, "transcript.json"),
      "utf8",
    );
    assert.doesNotMatch(written, /sk-live-secret/);
    assert.match(written, /\$\{API_KEY\}/);
  });
});

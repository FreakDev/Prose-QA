import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createEnvRedactor } from "../redact/env-secrets.js";
import {
  buildReport,
  renderScenarioSummaryHtml,
  writeScenarioTranscript,
  writeTranscript,
} from "./index.js";
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

describe("writeScenarioTranscript", () => {
  it("writes verdict.json with harness-computed stats", () => {
    const artifactDir = mkdtempSync(path.join(tmpdir(), "pqa-verdict-"));
    writeScenarioTranscript(artifactDir, {
      scenario: "hello-world",
      filePath: "scenarios/hello-world.md",
      status: "pass",
      durationMs: 12_750,
      verdict: {
        status: "pass",
        checkpoints: [
          {
            assertion: "page shows Hello",
            pass: true,
            reason: "heading visible",
          },
        ],
        summary: "All checkpoints passed",
        stats: {
          durationMs: 12_750,
          llmTurns: 1,
          userTurns: 1,
          toolCalls: 1,
          failedToolCalls: 0,
          llmDurationMs: 5000,
          bashDurationMs: 200,
          tokens: { input: 42_000, output: 1_200, cached: 10_000 },
        },
      },
      transcript: {
        entries: [
          {
            type: "message",
            role: "user",
            content: "go",
            at: "2026-01-01T00:00:00.000Z",
          },
          {
            type: "message",
            role: "assistant",
            content: '[tool bash] {"command":"agent-browser snapshot -i"}',
            at: "2026-01-01T00:00:05.000Z",
            durationMs: 5000,
          },
          {
            type: "bash",
            command: "agent-browser snapshot -i",
            stdout: "ok",
            stderr: "",
            exitCode: 0,
            durationMs: 200,
            at: "2026-01-01T00:00:05.000Z",
          },
        ],
      },
      healing: {
        used: false,
        recoveryTurns: 0,
        scenarioRetries: 0,
      },
    });

    const written = JSON.parse(
      readFileSync(path.join(artifactDir, "verdict.json"), "utf8"),
    ) as {
      stats: {
        durationMs: number;
        llmTurns: number;
        userTurns: number;
        toolCalls: number;
        tokens?: { input: number; output: number; cached?: number };
      };
    };

    assert.equal(written.stats.durationMs, 12_750);
    assert.equal(written.stats.llmTurns, 1);
    assert.equal(written.stats.userTurns, 1);
    assert.equal(written.stats.toolCalls, 1);
    assert.deepEqual(written.stats.tokens, {
      input: 42_000,
      output: 1_200,
      cached: 10_000,
    });
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

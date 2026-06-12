import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { readFileSync as readSource } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { AgentTranscript } from "../types/verdict.js";
import {
  appendFinalTextToTranscript,
  appendStepToTranscript,
  appendTranscriptMessage,
} from "./verdict.js";
import { persistTranscript } from "./transcript-persist.js";

const runnerSource = readSource(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "runner.ts"),
  "utf8",
);

const EXPECTED_PERSIST_CALL_SITES = 8;

function readTranscriptOnDisk(artifactDir: string) {
  return JSON.parse(
    readFileSync(path.join(artifactDir, "transcript.json"), "utf8"),
  ) as { entries: Array<{ type: string; role?: string }> };
}

describe("runner transcript persistence contract", () => {
  it("delegates disk writes to persistTranscript helper", () => {
    assert.match(
      runnerSource,
      /import \{ persistTranscript \} from "\.\/transcript-persist\.js"/,
    );
    assert.doesNotMatch(runnerSource, /writeTranscript/);
  });

  it("calls persistTranscript at every transcript mutation point", () => {
    const calls = runnerSource.match(/persistTranscript\(/g) ?? [];
    assert.equal(calls.length, EXPECTED_PERSIST_CALL_SITES);
  });

  it("exposes load_skill tool when on-demand skills are enabled", () => {
    assert.match(runnerSource, /tools\.load_skill = tool\(/);
    assert.match(runnerSource, /SkillLoadRegistry/);
  });

  it("does not gate disk writes on verbose", () => {
    assert.doesNotMatch(
      runnerSource,
      /if\s*\(\s*options\.verbose\s*\)\s*\{[\s\S]*?writeTranscript/,
    );
    assert.doesNotMatch(
      runnerSource,
      /function persistTranscript[\s\S]*?if\s*\(\s*options\.verbose\s*\)/,
    );
  });

  it("persists after initial user messages (including optional auto-loaded skills)", () => {
    assert.match(
      runnerSource,
      /appendTranscriptMessage\(transcript,\s*"user",\s*initialPrompt\);[\s\S]*?persistTranscript\(options,\s*transcript\);/,
    );
  });

  it("persists after each assistant step", () => {
    assert.match(
      runnerSource,
      /if\s*\(changed\)\s*\{\s*\n\s*persistTranscript\(options,\s*transcript\);\s*\n\s*\}/,
    );
  });

  it("persists after the main completion and on errors", () => {
    assert.match(
      runnerSource,
      /appendFinalTextToTranscript\([\s\S]*?\);\s*\n\s*stepTiming\.startMs = Date\.now\(\);\s*\n\s*persistTranscript\(options,\s*transcript\);/,
    );
    assert.match(
      runnerSource,
      /catch\s*\(err\)\s*\{[\s\S]*?persistTranscript\(options,\s*transcript\);/,
    );
  });

  it("guards LLM calls against doomed browser runs", () => {
    assert.match(runnerSource, /assertNoDoomedRun\(/);
    assert.match(
      runnerSource,
      /withinTurnFingerprints:\s*\n\s*\(hookCtx\.metadata\.browserFailureFingerprints as string\[\]\)/,
    );
  });

  it("persists during verdict retry and recovery flows", () => {
    assert.match(
      runnerSource,
      /appendTranscriptMessage\(options\.transcript,\s*"user",\s*retryPrompt\);\s*\n\s*persistTranscript\(options\.runOptions,\s*options\.transcript\);/,
    );
    assert.match(
      runnerSource,
      /appendTranscriptMessage\(transcript,\s*"user",\s*recoveryPrompt\);\s*\n\s*persistTranscript\(options,\s*transcript\);/,
    );
  });
});

describe("runner transcript persistence flow", () => {
  it("updates transcript.json on disk after each runner-style persist point", () => {
    const artifactDir = mkdtempSync(path.join(tmpdir(), "pqa-runner-flow-"));
    const options = { artifactDir };
    const transcript: AgentTranscript = { entries: [] };

    appendTranscriptMessage(transcript, "user", "Run the scenario.");
    persistTranscript(options, transcript);
    assert.deepEqual(readTranscriptOnDisk(artifactDir).entries.map((e) => e.role), [
      "user",
    ]);

    appendStepToTranscript(
      transcript,
      {
        text: "Opening the dashboard.",
        toolCalls: [{ toolName: "bash", input: { command: "agent-browser open /" } }],
      },
      [
        {
          command: "agent-browser open /",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 12,
        },
      ],
    );
    persistTranscript(options, transcript);
    assert.equal(readTranscriptOnDisk(artifactDir).entries.length, 3);

    appendFinalTextToTranscript(transcript, "Opening the dashboard.");
    persistTranscript(options, transcript);
    assert.equal(readTranscriptOnDisk(artifactDir).entries.length, 4);

    appendTranscriptMessage(transcript, "user", "Emit a valid verdict JSON block.");
    persistTranscript(options, transcript);
    assert.equal(readTranscriptOnDisk(artifactDir).entries.length, 5);
    assert.deepEqual(
      readTranscriptOnDisk(artifactDir).entries
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.role),
      ["user", "assistant", "assistant", "user"],
    );

    assert.equal(existsSync(path.join(artifactDir, "transcript.json")), true);
  });
});

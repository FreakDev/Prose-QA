import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTranscript } from "../types/verdict.js";
import type { HookContext } from "../types/hooks.js";
import type { Scenario } from "../types/scenario.js";
import {
  runGuardPostToolHook,
  runGuardPreLlmTurnHook,
} from "./run-guard-hooks.js";
import { RunGuardSyntheticFailError } from "../agent/run-guard.js";

const scenario: Scenario = {
  filePath: "/s.md",
  frontmatter: { name: "demo" },
  skills: [],
  goal: "g",
  steps: "1. Act",
  then: ['page shows "OK"'],
  rawCheckpoints: [],
  checkpoints: [],
};

function makeCtx(
  transcript: AgentTranscript,
  metadata: Record<string, unknown> = {},
): HookContext {
  return {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    cwd: process.cwd(),
    config: {
      llm: {},
      browser: {
        headed: false,
        sessionName: "pqa",
        defaultTimeout: 25_000,
        engine: "chrome",
      },
      skills: { dirs: [], preloads: [] },
      agent: {
        maxTurns: 10,
        bashTimeoutMs: 60_000,
        guard: {
          nudgeFailedToolCalls: 2,
          maxFailedToolCalls: 4,
          maxRecoverySteps: 10,
        },
      },
    },
    transcript,
    metadata: { scenario, ...metadata },
    abort: (reason: string): never => {
      throw new Error(reason);
    },
  };
}

function failedEntry(index: number): AgentTranscript["entries"][number] {
  return {
    type: "bash",
    command: `agent-browser click @e${index}`,
    stdout: "",
    stderr: "failed",
    exitCode: 1,
    durationMs: 1,
    at: "2026-01-01T00:00:00.000Z",
  };
}

describe("runGuard hooks", () => {
  it("continues postTool below abort threshold", async () => {
    const transcript: AgentTranscript = { entries: [failedEntry(1)] };
    const result = await runGuardPostToolHook(
      {
        command: "agent-browser click @e1",
        stdout: "",
        stderr: "failed",
        exitCode: 1,
        durationMs: 1,
      },
      makeCtx(transcript),
    );
    assert.equal(result.action, "continue");
  });

  it("throws RunGuardSyntheticFailError at abort threshold", async () => {
    const transcript: AgentTranscript = {
      entries: [failedEntry(1), failedEntry(2), failedEntry(3)],
    };
    await assert.rejects(
      async () => {
        await runGuardPostToolHook(
          {
            command: "agent-browser click @e4",
            stdout: "",
            stderr: "failed",
            exitCode: 1,
            durationMs: 1,
          },
          makeCtx(transcript),
        );
      },
      RunGuardSyntheticFailError,
    );
  });

  it("injects nudge once at nudge threshold", async () => {
    const transcript: AgentTranscript = {
      entries: [failedEntry(1), failedEntry(2)],
    };
    const ctx = makeCtx(transcript, { guardNudgeSent: false });
    const first = await runGuardPreLlmTurnHook(
      { messages: [], turn: 0, maxTurns: 10 },
      ctx,
    );
    const nudgeContent = first.extraMessages?.[0]?.content;
    assert.equal(typeof nudgeContent, "string");
    assert.match(nudgeContent as string, /Run guard nudge/);
    assert.equal(ctx.metadata.guardNudgeSent, true);

    const second = await runGuardPreLlmTurnHook(
      { messages: [], turn: 1, maxTurns: 10 },
      ctx,
    );
    assert.equal(second.extraMessages, undefined);
  });
});

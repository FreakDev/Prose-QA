import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentTranscript } from "../types/verdict.js";
import type { Scenario } from "../types/scenario.js";
import type { PqaConfig } from "../types/config.js";
import {
  assertNoRunGuard,
  buildGuardNudgeMessage,
  buildSyntheticGuardVerdict,
  countFailedAgentBrowserCalls,
  evaluateRunGuard,
  RunGuardSyntheticFailError,
} from "./run-guard.js";

const baseConfig: PqaConfig = {
  llm: { provider: "anthropic", model: "x" },
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine: "chrome",
  },
  skills: { dirs: [], preloads: [] },
  agent: {
    maxTurns: 30,
    bashTimeoutMs: 120_000,
    guard: {
      nudgeFailedToolCalls: 3,
      maxFailedToolCalls: 5,
      maxRecoverySteps: 10,
    },
  },
};

const scenario: Scenario = {
  filePath: "/s.md",
  frontmatter: { name: "demo" },
  skills: [],
  goal: "g",
  steps: "1. Act",
  then: ['url contains "/done"', 'page shows "OK"'],
  rawCheckpoints: [],
  checkpoints: [],
};

function failedBash(command: string): AgentTranscript["entries"][number] {
  return {
    type: "bash",
    command,
    stdout: "",
    stderr: "command failed",
    exitCode: 1,
    durationMs: 1,
    at: "2026-01-01T00:00:00.000Z",
  };
}

function transcriptWithFailed(count: number): AgentTranscript {
  const entries: AgentTranscript["entries"] = [];
  for (let i = 0; i < count; i++) {
    entries.push(failedBash(`agent-browser click @e${i}`));
  }
  return { entries };
}

describe("run-guard", () => {
  it("counts failed agent-browser calls only", () => {
    const transcript: AgentTranscript = {
      entries: [
        failedBash("agent-browser click @e1"),
        {
          type: "bash",
          command: "echo ok",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          at: "2026-01-01T00:00:00.000Z",
        },
        failedBash("agent-browser snapshot -i"),
      ],
    };
    assert.equal(countFailedAgentBrowserCalls(transcript), 2);
  });

  it("returns nudge at the lower threshold once", () => {
    const metadata = { guardNudgeSent: false };
    const evaluation = evaluateRunGuard({
      transcript: transcriptWithFailed(3),
      config: baseConfig,
      metadata,
    });
    assert.equal(evaluation.level, "nudge");
    assert.equal(evaluation.failedCount, 3);
  });

  it("returns ok after nudge was already sent below abort threshold", () => {
    const metadata = { guardNudgeSent: true };
    const evaluation = evaluateRunGuard({
      transcript: transcriptWithFailed(3),
      config: baseConfig,
      metadata,
    });
    assert.equal(evaluation.level, "ok");
  });

  it("returns abort at maxFailedToolCalls", () => {
    const evaluation = evaluateRunGuard({
      transcript: transcriptWithFailed(5),
      config: baseConfig,
      metadata: {},
    });
    assert.equal(evaluation.level, "abort");
  });

  it("builds synthetic verdict for every Then checkpoint", () => {
    const transcript = transcriptWithFailed(5);
    const verdict = buildSyntheticGuardVerdict(scenario, 5, 5, transcript);
    assert.equal(verdict.status, "fail");
    assert.equal(verdict.checkpoints.length, 2);
    assert.ok(verdict.checkpoints.every((cp) => !cp.pass));
    assert.match(verdict.summary, /run guard/i);
  });

  it("throws RunGuardSyntheticFailError from assertNoRunGuard", () => {
    assert.throws(
      () =>
        assertNoRunGuard({
          transcript: transcriptWithFailed(5),
          config: baseConfig,
          metadata: {},
          scenario,
        }),
      RunGuardSyntheticFailError,
    );
  });

  it("builds a generic nudge message", () => {
    const message = buildGuardNudgeMessage(10, 20);
    assert.match(message, /10 agent-browser/);
    assert.match(message, /20 failed agent-browser/);
    assert.doesNotMatch(message, /project|seed/i);
  });
});

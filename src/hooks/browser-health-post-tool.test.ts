import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BashEntry } from "../types/verdict.js";
import type { AgentTranscript } from "../types/verdict.js";
import type { HookContext } from "../types/hooks.js";
import { browserHealthPostToolHook } from "./browser-health-post-tool.js";

function makeEntry(overrides: Partial<BashEntry> = {}): BashEntry {
  return {
    command: "agent-browser open https://example.com",
    stdout: "",
    stderr: "",
    exitCode: 1,
    durationMs: 10,
    ...overrides,
  };
}

function makeCtx(
  transcript: AgentTranscript = { entries: [] },
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
      agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
      browserHealth: { circuitBreakerThreshold: 3 },
    },
    transcript,
    metadata,
    abort: (reason: string): never => {
      throw new Error(reason);
    },
  };
}

describe("browserHealthPostToolHook", () => {
  it("continues on successful browser command", async () => {
    const result = await browserHealthPostToolHook(
      makeEntry({ exitCode: 0 }),
      makeCtx(),
    );
    assert.equal(result.action, "continue");
  });

  it("continues on non-fatal browser issue", async () => {
    const result = await browserHealthPostToolHook(
      makeEntry({
        stderr: "Error: listen EADDRINUSE: address already in use :::9222",
      }),
      makeCtx(),
    );
    assert.equal(result.action, "continue");
  });

  it("aborts on fatal browser issue", async () => {
    const result = await browserHealthPostToolHook(
      makeEntry({
        stderr: "agent-browser: command not found",
      }),
      makeCtx(),
    );
    assert.equal(result.action, "abort");
    if (result.action === "abort") {
      assert.match(result.error, /AGENT_BROWSER_MISSING/i);
    }
  });

  it("continues after two identical failures", async () => {
    const failed = makeEntry({
      command: "agent-browser click @e1",
      stderr: "Element not found",
    });
    const ctx = makeCtx(
      {
        entries: [
          {
            type: "bash",
            ...failed,
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      { browserFailureFingerprints: [] },
    );

    const result = await browserHealthPostToolHook(failed, ctx);
    assert.equal(result.action, "continue");
    assert.equal(
      (ctx.metadata.browserFailureFingerprints as string[]).length,
      1,
    );
  });

  it("aborts on third identical failure", async () => {
    const failed = makeEntry({
      command: "agent-browser click @e1",
      stderr: "Element not found",
    });
    const ctx = makeCtx(
      {
        entries: [
          {
            type: "bash",
            ...failed,
            at: "2026-01-01T00:00:00.000Z",
          },
          {
            type: "bash",
            command: "agent-browser click @e2",
            stdout: "",
            stderr: "Element not found",
            exitCode: 1,
            durationMs: 10,
            at: "2026-01-01T00:00:01.000Z",
          },
        ],
      },
      { browserFailureFingerprints: [] },
    );

    const result = await browserHealthPostToolHook(failed, ctx);
    assert.equal(result.action, "abort");
    if (result.action === "abort") {
      assert.match(result.error, /REPEATED_FAILURE/i);
    }
  });
});

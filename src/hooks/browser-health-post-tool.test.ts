import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BashEntry } from "../types/verdict.js";
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

describe("browserHealthPostToolHook", () => {
  it("continues on successful browser command", () => {
    const result = browserHealthPostToolHook(
      makeEntry({ exitCode: 0 }),
      {} as never,
    );
    assert.equal(result.action, "continue");
  });

  it("continues on non-fatal browser issue", () => {
    const result = browserHealthPostToolHook(
      makeEntry({
        stderr: "Error: listen EADDRINUSE: address already in use :::9222",
      }),
      {} as never,
    );
    assert.equal(result.action, "continue");
  });

  it("aborts on fatal browser issue", () => {
    const result = browserHealthPostToolHook(
      makeEntry({
        stderr: "agent-browser: command not found",
      }),
      {} as never,
    );
    assert.equal(result.action, "abort");
    if (result.action === "abort") {
      assert.match(result.error, /AGENT_BROWSER_MISSING/i);
    }
  });
});

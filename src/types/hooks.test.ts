import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHookContext,
  isPostToolResult,
  isPreScenarioResult,
} from "./hooks.js";

describe("HookContext type guard", () => {
  it("returns true for a valid HookContext", () => {
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      cwd: "/test",
      config: { llm: {} },
      transcript: { entries: [] },
      metadata: {},
      abort: (reason: string) => {
        throw new Error(reason);
      },
    };
    assert.equal(isHookContext(ctx), true);
  });

  it("returns false for null", () => {
    assert.equal(isHookContext(null), false);
  });

  it("returns false for a plain object missing logger", () => {
    assert.equal(isHookContext({ cwd: "/test" }), false);
  });

  it("returns false for a non-object", () => {
    assert.equal(isHookContext("string"), false);
  });
});

describe("PreScenarioResult type guard", () => {
  it("returns true for a continue result", () => {
    assert.equal(isPreScenarioResult({ action: "continue" }), true);
  });

  it("returns true for a skip result", () => {
    assert.equal(isPreScenarioResult({ action: "skip", reason: "test" }), true);
  });

  it("returns true for an abort result", () => {
    assert.equal(isPreScenarioResult({ action: "abort", error: "test" }), true);
  });

  it("returns false for an unknown action", () => {
    assert.equal(isPreScenarioResult({ action: "unknown" }), false);
  });

  it("returns false for null", () => {
    assert.equal(isPreScenarioResult(null), false);
  });

  it("returns false for a non-object", () => {
    assert.equal(isPreScenarioResult(42), false);
  });
});

describe("PostToolResult type guard", () => {
  it("returns true for a continue result", () => {
    assert.equal(isPostToolResult({ action: "continue" }), true);
  });

  it("returns true for an abort result", () => {
    assert.equal(isPostToolResult({ action: "abort", error: "test" }), true);
  });

  it("returns false for an unknown action", () => {
    assert.equal(isPostToolResult({ action: "unknown" }), false);
  });

  it("returns false for null", () => {
    assert.equal(isPostToolResult(null), false);
  });
});

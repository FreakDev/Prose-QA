import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureProfilesBatchHook } from "./ensure-profiles-batch.js";

describe("ensureProfilesBatchHook", () => {
  it("continues when requiredProfiles is empty", async () => {
    const result = await ensureProfilesBatchHook(
      {
        runId: "run-1",
        runDir: "/tmp/run",
        entrypoint: "run",
        scenarios: [],
        requiredProfiles: [],
      },
      {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        cwd: "/tmp",
        config: { llm: {}, auth: {} } as never,
        transcript: { entries: [] },
        metadata: {},
        abort: (reason: string): never => {
          throw new Error(reason);
        },
      },
    );
    assert.equal(result.action, "continue");
  });

  it("aborts when ensureAuthContext is missing", async () => {
    const result = await ensureProfilesBatchHook(
      {
        runId: "run-1",
        runDir: "/tmp/run",
        entrypoint: "run",
        scenarios: [{ name: "checkout", auth: "admin" }],
        requiredProfiles: ["admin"],
      },
      {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        cwd: "/tmp",
        config: { llm: {}, auth: { admin: { scenario: "login-admin" } } } as never,
        transcript: { entries: [] },
        metadata: {},
        abort: (reason: string): never => {
          throw new Error(reason);
        },
      },
    );
    assert.equal(result.action, "abort");
  });
});

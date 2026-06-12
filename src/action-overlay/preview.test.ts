import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { BashEntry } from "../types/verdict.js";
import { previewAction } from "./preview.js";

function mockBashEntry(command: string, stdout = ""): BashEntry {
  return {
    command,
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 1,
  };
}

describe("previewAction", () => {
  it("does nothing for non-agent-browser commands", async () => {
    const runBash = mock.fn(async () => mockBashEntry(""));

    await previewAction(
      {
        command: "echo hello",
        cwd: "/tmp",
        env: {},
        timeoutMs: 5000,
        previewMs: 10,
      },
      runBash,
    );

    assert.equal(runBash.mock.calls.length, 0);
  });

  it("runs get box, eval, and sleeps for mutation with target", async () => {
    const calls: string[] = [];
    const runBash = mock.fn(async (command: string) => {
      calls.push(command);
      if (command.includes("get box")) {
        return mockBashEntry(
          command,
          JSON.stringify({
            success: true,
            data: { x: 10, y: 20, width: 100, height: 40 },
          }),
        );
      }
      return mockBashEntry(command);
    });

    const start = Date.now();
    await previewAction(
      {
        command: "agent-browser click @e2",
        cwd: "/tmp",
        env: {},
        timeoutMs: 5000,
        previewMs: 30,
      },
      runBash,
    );
    const elapsed = Date.now() - start;

    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /get box '@e2'/);
    assert.match(calls[1]!, /agent-browser eval -b/);
    assert.ok(elapsed >= 25);
  });

  it("runs eval only for observation commands", async () => {
    const calls: string[] = [];
    const runBash = mock.fn(async (command: string) => {
      calls.push(command);
      return mockBashEntry(command);
    });

    await previewAction(
      {
        command: "agent-browser snapshot -i",
        cwd: "/tmp",
        env: {},
        timeoutMs: 5000,
        previewMs: 10,
      },
      runBash,
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /agent-browser eval -b/);
    const encoded = /eval -b '([^']+)'/.exec(calls[0]!)?.[1];
    assert.ok(encoded);
    const js = Buffer.from(encoded, "base64").toString("utf-8");
    assert.match(js, /"detail":"Snapshot -i"/);
  });

  it("includes LLM intent in eval payload when provided", async () => {
    const calls: string[] = [];
    const runBash = mock.fn(async (command: string) => {
      calls.push(command);
      if (command.includes("get box")) {
        return mockBashEntry(
          command,
          JSON.stringify({
            success: true,
            data: { x: 1, y: 2, width: 10, height: 10 },
          }),
        );
      }
      return mockBashEntry(command);
    });

    await previewAction(
      {
        command: "agent-browser click @e2",
        cwd: "/tmp",
        env: {},
        timeoutMs: 5000,
        previewMs: 10,
        intent: "Submit the login form — @e2",
      },
      runBash,
    );

    const evalCall = calls.find((c) => c.includes("agent-browser eval -b"));
    assert.ok(evalCall);
    const encoded = /eval -b '([^']+)'/.exec(evalCall!)?.[1];
    assert.ok(encoded);
    const js = Buffer.from(encoded!, "base64").toString("utf-8");
    assert.match(js, /Submit the login form — @e2/);
    assert.match(js, /"detail":"Click @e2"/);
  });
});

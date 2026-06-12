import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExtensionHooks,
  HookContext,
  PostLlmTurnHook,
  PostScenarioHook,
  PostToolHook,
  PreLlmTurnHook,
  PreScenarioHook,
  PreSystemPromptHook,
  PreToolHook,
  PreVerdictHook,
} from "../types/hooks.js";
import { HookRunner, HookAbortError } from "./hooks.js";
import type { Scenario } from "../types/scenario.js";
import type { BashEntry, ScenarioResult } from "../types/verdict.js";

function makeScenario(overrides?: Partial<Scenario>): Scenario {
  return {
    filePath: "/test/scenario.md",
    frontmatter: { name: "test-scenario" },
    skills: [],
    goal: "test goal",
    steps: "test steps",
    then: ["checkpoint 1"],
    rawCheckpoints: ["checkpoint 1"],
    checkpoints: [{ raw: "checkpoint 1", kind: "semantic" }],
    ...overrides,
  };
}

function makeHookContext(overrides?: Partial<HookContext>): HookContext {
  const logs: string[] = [];
  return {
    logger: {
      info: (msg: string) => {
        logs.push(`info: ${msg}`);
      },
      warn: (msg: string) => {
        logs.push(`warn: ${msg}`);
      },
      error: (msg: string) => {
        logs.push(`error: ${msg}`);
      },
    },
    cwd: "/test",
    config: { llm: {} } as any,
    transcript: { entries: [] },
    metadata: {},
    abort: (reason: string): never => {
      throw new HookAbortError(reason);
    },
    ...overrides,
  };
}

describe("HookRunner", () => {
  describe("runPreBatch", () => {
    it("returns continue when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPreBatch({
        runId: "run-1",
        runDir: "/tmp/run",
        entrypoint: "run",
        scenarios: [],
        requiredProfiles: [],
      });
      assert.equal(result.action, "continue");
    });

    it("short-circuits on abort", async () => {
      const hooks: ExtensionHooks = {
        preBatch: [() => ({ action: "abort" as const, error: "batch failed" })],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreBatch({
        runId: "run-1",
        runDir: "/tmp/run",
        entrypoint: "run",
        scenarios: [],
        requiredProfiles: [],
      });
      assert.equal(result.action, "abort");
    });
  });

  describe("runPostBatch", () => {
    it("returns continue when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPostBatch({
        runId: "run-1",
        runDir: "/tmp/run",
        entrypoint: "run",
        scenarios: [],
        requiredProfiles: [],
        results: [],
        status: "pass",
      });
      assert.equal(result.action, "continue");
    });
  });

  describe("runPreScenario", () => {
    it("returns continue when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPreScenario(makeScenario());
      assert.equal(result.action, "continue");
    });

    it("returns continue when all hooks return continue", async () => {
      const hooks: ExtensionHooks = {
        preScenario: [
          () => ({ action: "continue" as const }),
          () => ({ action: "continue" as const }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreScenario(makeScenario());
      assert.equal(result.action, "continue");
    });

    it("short-circuits on skip", async () => {
      let secondCalled = false;
      const hooks: ExtensionHooks = {
        preScenario: [
          () => ({ action: "skip" as const, reason: "not now" }),
          () => {
            secondCalled = true;
            return { action: "continue" as const };
          },
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreScenario(makeScenario());
      assert.equal(result.action, "skip");
      assert.equal((result as { reason: string }).reason, "not now");
      assert.equal(secondCalled, false);
    });

    it("short-circuits on abort", async () => {
      const hooks: ExtensionHooks = {
        preScenario: [
          () => ({ action: "abort" as const, error: "fatal" }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreScenario(makeScenario());
      assert.equal(result.action, "abort");
      assert.equal((result as { error: string }).error, "fatal");
    });

    it("continues when a hook throws an exception (fail-safe)", async () => {
      const hooks: ExtensionHooks = {
        preScenario: [
          () => {
            throw new Error("hook crash");
          },
          () => ({ action: "continue" as const }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreScenario(makeScenario());
      assert.equal(result.action, "continue");
    });

    it("preserves browserContext from continue result", async () => {
      const hooks: ExtensionHooks = {
        preScenario: [
          () => ({
            action: "continue" as const,
            browserContext: {
              profilePath: "/tmp/.pqa/profiles/admin",
            },
          }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreScenario(makeScenario());
      assert.equal(result.action, "continue");
      if (result.action === "continue") {
        assert.equal(
          result.browserContext?.profilePath,
          "/tmp/.pqa/profiles/admin",
        );
      }
    });
  });

  describe("runPreSystemPrompt", () => {
    it("returns empty when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPreSystemPrompt({
        config: {} as any,
        skills: [],
        scenario: makeScenario(),
        runtime: {} as any,
      });
      assert.deepEqual(result, {});
    });

    it("concatenates extraInstructions from multiple hooks", async () => {
      const hooks: ExtensionHooks = {
        preSystemPrompt: [
          () => ({ extraInstructions: "instruction one" }),
          () => ({ extraInstructions: "instruction two" }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreSystemPrompt({
        config: {} as any,
        skills: [],
        scenario: makeScenario(),
        runtime: {} as any,
      });
      assert.equal(result.extraInstructions, "instruction one\ninstruction two");
    });

    it("skips hooks that throw (fail-safe)", async () => {
      const hooks: ExtensionHooks = {
        preSystemPrompt: [
          () => {
            throw new Error("crash");
          },
          () => ({ extraInstructions: "survived" }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreSystemPrompt({
        config: {} as any,
        skills: [],
        scenario: makeScenario(),
        runtime: {} as any,
      });
      assert.equal(result.extraInstructions, "survived");
    });
  });

  describe("runPreLlmTurn", () => {
    it("returns empty when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPreLlmTurn({
        messages: [{ role: "user", content: "hello" }],
        turn: 0,
        maxTurns: 10,
      });
      assert.deepEqual(result, {});
    });

    it("concatenates extraMessages from multiple hooks", async () => {
      const hooks: ExtensionHooks = {
        preLlmTurn: [
          () => ({ extraMessages: [{ role: "user" as const, content: "msg1" }] }),
          () => ({
            extraMessages: [
              { role: "user" as const, content: "msg2" },
              { role: "assistant" as const, content: "msg3" },
            ],
          }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreLlmTurn({
        messages: [],
        turn: 0,
        maxTurns: 10,
      });
      assert.equal(result.extraMessages?.length, 3);
      assert.equal(result.extraMessages![0]!.content, "msg1");
      assert.equal(result.extraMessages![1]!.content, "msg2");
      assert.equal(result.extraMessages![2]!.content, "msg3");
    });
  });

  describe("runPostLlmTurn", () => {
    it("returns empty when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPostLlmTurn({
        text: "original",
        reasoningText: undefined,
        toolCalls: [],
        turn: 0,
        durationMs: 100,
      });
      assert.deepEqual(result, {});
    });

    it("last hook wins for text", async () => {
      const hooks: ExtensionHooks = {
        postLlmTurn: [
          () => ({ text: "from first" }),
          () => ({ text: "from second" }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPostLlmTurn({
        text: "original",
        reasoningText: undefined,
        toolCalls: [],
        turn: 0,
        durationMs: 100,
      });
      assert.equal(result.text, "from second");
    });
  });

  describe("runPreTool", () => {
    it("returns empty result when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPreTool({
        command: "echo hello",
        timeoutMs: 1000,
        env: {},
      });
      assert.equal(result.action, "continue");
    });

    it("allows hooks to modify command and timeout", async () => {
      const hooks: ExtensionHooks = {
        preTool: [
          () => ({ command: "echo modified", timeoutMs: 500 }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreTool({
        command: "echo hello",
        timeoutMs: 1000,
        env: {},
      });
      assert.equal(result.command, "echo modified");
      assert.equal(result.timeoutMs, 500);
    });

    it("takes min timeout when multiple hooks reduce it", async () => {
      const hooks: ExtensionHooks = {
        preTool: [
          () => ({ timeoutMs: 800 }),
          () => ({ timeoutMs: 300 }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreTool({
        command: "echo hello",
        timeoutMs: 1000,
        env: {},
      });
      assert.equal(result.timeoutMs, 300);
    });

    it("aborts on abort action", async () => {
      const hooks: ExtensionHooks = {
        preTool: [
          () => ({ action: "abort" as const, abortError: "no bash" }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreTool({
        command: "echo hello",
        timeoutMs: 1000,
        env: {},
      });
      assert.equal(result.action, "abort");
      assert.equal((result as any).abortError, "no bash");
    });

    it("merges extraEnv from multiple hooks", async () => {
      const hooks: ExtensionHooks = {
        preTool: [
          () => ({ extraEnv: { FOO: "bar" } }),
          () => ({ extraEnv: { BAZ: "qux" } }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreTool({
        command: "echo hello",
        timeoutMs: 1000,
        env: {},
      });
      assert.deepEqual(result.extraEnv, { FOO: "bar", BAZ: "qux" });
    });
  });

  describe("runPostTool", () => {
    it("returns continue when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const entry: BashEntry = {
        command: "echo hello",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
      };
      const result = await runner.runPostTool(entry);
      assert.equal(result.action, "continue");
    });

    it("returns continue when all hooks return continue", async () => {
      const hooks: ExtensionHooks = {
        postTool: [() => ({ action: "continue" as const })],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const entry: BashEntry = {
        command: "echo hello",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
      };
      const result = await runner.runPostTool(entry);
      assert.equal(result.action, "continue");
    });

    it("short-circuits on abort", async () => {
      let secondCalled = false;
      const hooks: ExtensionHooks = {
        postTool: [
          () => ({ action: "abort" as const, error: "fail! " }),
          () => {
            secondCalled = true;
            return { action: "continue" as const };
          },
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const entry: BashEntry = {
        command: "echo hello",
        stdout: "",
        stderr: "",
        exitCode: 1,
        durationMs: 10,
      };
      const result = await runner.runPostTool(entry);
      assert.equal(result.action, "abort");
      assert.equal(secondCalled, false);
    });

    it("re-throws foreign RunGuardSyntheticFailError without logging", async () => {
      const logs: string[] = [];
      const hooks: ExtensionHooks = {
        postTool: [
          async () => {
            const err = new Error("Run guard: stopped");
            err.name = "RunGuardSyntheticFailError";
            (err as Error & { verdict: unknown }).verdict = {
              status: "fail",
              summary: "stopped",
              checkpoints: [],
            };
            throw err;
          },
        ],
      };
      const runner = new HookRunner(hooks, {
        ...makeHookContext(),
        logger: {
          info: () => {},
          warn: () => {},
          error: (msg) => logs.push(msg),
        },
      });
      const entry: BashEntry = {
        command: "agent-browser click @e1",
        stdout: "",
        stderr: "x",
        exitCode: 1,
        durationMs: 10,
      };

      await assert.rejects(() => runner.runPostTool(entry), (err: unknown) => {
        assert.equal((err as Error).name, "RunGuardSyntheticFailError");
        return true;
      });
      assert.deepEqual(logs, []);
    });
  });

  describe("runPreVerdict", () => {
    it("returns empty when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPreVerdict({
        finalText: "original",
        transcript: { entries: [] },
      });
      assert.deepEqual(result, {});
    });

    it("last hook wins for finalText", async () => {
      const hooks: ExtensionHooks = {
        preVerdict: [
          () => ({ finalText: "from first" }),
          () => ({ finalText: "from second" }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreVerdict({
        finalText: "original",
        transcript: { entries: [] },
      });
      assert.equal(result.finalText, "from second");
    });
  });

  describe("runPostScenario", () => {
    it("returns empty when no hooks", async () => {
      const runner = new HookRunner({}, makeHookContext());
      const result = await runner.runPostScenario({
        scenario: "test",
        filePath: "/test.md",
        status: "pass",
        durationMs: 100,
        verdict: null,
        transcript: { entries: [] },
      });
      assert.deepEqual(result, {});
    });

    it("merges result fields from multiple hooks via spread", async () => {
      const hooks: ExtensionHooks = {
        postScenario: [
          () => ({ result: { status: "fail" as const } }),
          () => ({ result: { error: "modified" } }),
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const baseResult: ScenarioResult = {
        scenario: "test",
        filePath: "/test.md",
        status: "pass",
        durationMs: 100,
        verdict: null,
        transcript: { entries: [] },
      };
      const result = await runner.runPostScenario(baseResult);
      assert.ok(result.result);
      assert.equal(result.result!.status, "fail");
      assert.equal(result.result!.error, "modified");
    });
  });

  describe("metadata propagation", () => {
    it("allows hooks to communicate via mutable metadata", async () => {
      const ctx = makeHookContext();
      ctx.metadata = {};

      const hooks: ExtensionHooks = {
        preSystemPrompt: [
          (params, c) => {
            c.metadata["key"] = "value-set-by-first";
            return {};
          },
        ],
        preLlmTurn: [
          (params, c) => {
            // Read metadata set by previous hook
            const val = c.metadata["key"] as string;
            return {
              extraMessages: [
                { role: "user" as const, content: `metadata was: ${val}` },
              ],
            };
          },
        ],
      };
      const runner = new HookRunner(hooks, ctx);
      await runner.runPreSystemPrompt({
        config: {} as any,
        skills: [],
        scenario: makeScenario(),
        runtime: {} as any,
      });
      const llmResult = await runner.runPreLlmTurn({
        messages: [],
        turn: 0,
        maxTurns: 10,
      });
      assert.equal(llmResult.extraMessages?.[0]?.content, "metadata was: value-set-by-first");
    });
  });

  describe("fail-safe behavior", () => {
    it("continues executing remaining hooks after a throw", async () => {
      const callOrder: number[] = [];
      const hooks: ExtensionHooks = {
        preSystemPrompt: [
          () => {
            callOrder.push(1);
            return {};
          },
          () => {
            callOrder.push(2);
            throw new Error("crash");
          },
          () => {
            callOrder.push(3);
            return { extraInstructions: "survivor" };
          },
        ],
      };
      const runner = new HookRunner(hooks, makeHookContext());
      const result = await runner.runPreSystemPrompt({
        config: {} as any,
        skills: [],
        scenario: makeScenario(),
        runtime: {} as any,
      });
      assert.deepEqual(callOrder, [1, 2, 3]);
      assert.equal(result.extraInstructions, "survivor");
    });
  });
});

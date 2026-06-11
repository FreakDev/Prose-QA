import type { ModelMessage } from "ai";
import type {
  ExtensionHooks,
  HookContext,
  PostBatchParams,
  PostBatchResult,
  PostBatchResultAbort,
  PostBatchResultContinue,
  PostLlmTurnParams,
  PostLlmTurnResult,
  PostScenarioResult,
  PostToolResult,
  PreBatchParams,
  PreBatchResult,
  PreBatchResultAbort,
  PreBatchResultContinue,
  PreLlmTurnParams,
  PreLlmTurnResult,
  PreScenarioResult,
  PreScenarioResultAbort,
  PreScenarioResultContinue,
  PreScenarioResultSkip,
  PreSystemPromptParams,
  PreSystemPromptResult,
  PreToolParams,
  PreToolResult,
  PreVerdictParams,
  PreVerdictResult,
  ProfileBrowserContext,
} from "../types/hooks.js";
import type { Scenario } from "../types/scenario.js";
import type { BashEntry, ScenarioResult } from "../types/verdict.js";

export class HookAbortError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Hook aborted: ${reason}`);
    this.name = "HookAbortError";
    this.reason = reason;
  }
}

function makeHookAbort(reason: string): never {
  throw new HookAbortError(reason);
}

type HookLogger = HookContext["logger"];

function safeCall<T>(
  label: string,
  logger: HookLogger,
  fn: () => T | Promise<T>,
  fallback: T,
): Promise<T> {
  return (async () => {
    try {
      return await fn();
    } catch (err) {
      logger.error(`[hooks] ${label} threw: ${err instanceof Error ? err.message : String(err)}`);
      return fallback;
    }
  })();
}

export class HookRunner {
  private hooks: ExtensionHooks;
  private ctx: HookContext;

  constructor(extensionHooks: ExtensionHooks, ctx: HookContext) {
    this.hooks = extensionHooks;
    this.ctx = ctx;
  }

  // ── PreBatch ─────────────────────────────────

  async runPreBatch(
    params: PreBatchParams,
  ): Promise<PreBatchResultContinue | PreBatchResultAbort> {
    const hooks = this.hooks.preBatch ?? [];
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `preBatch[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(params, this.ctx),
        { action: "continue" } as PreBatchResult,
      );
      if (result.action === "abort") {
        return result;
      }
    }
    return { action: "continue" };
  }

  // ── PostBatch ────────────────────────────────

  async runPostBatch(
    params: PostBatchParams,
  ): Promise<PostBatchResultContinue | PostBatchResultAbort> {
    const hooks = this.hooks.postBatch ?? [];
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `postBatch[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(params, this.ctx),
        { action: "continue" } as PostBatchResult,
      );
      if (result.action === "abort") {
        return result;
      }
    }
    return { action: "continue" };
  }

  // ── PreScenario ──────────────────────────────

  async runPreScenario(
    scenario: Scenario,
  ): Promise<
    | PreScenarioResultContinue
    | PreScenarioResultSkip
    | PreScenarioResultAbort
  > {
    const hooks = this.hooks.preScenario ?? [];
    let browserContext: ProfileBrowserContext | undefined;
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `preScenario[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(scenario, this.ctx),
        { action: "continue" } as PreScenarioResult,
      );
      if (result.action === "skip" || result.action === "abort") {
        return result;
      }
      if (result.action === "continue" && result.browserContext) {
        browserContext = result.browserContext;
      }
    }
    return browserContext
      ? { action: "continue", browserContext }
      : { action: "continue" };
  }

  // ── PreSystemPrompt ──────────────────────────

  async runPreSystemPrompt(
    params: PreSystemPromptParams,
  ): Promise<PreSystemPromptResult> {
    const hooks = this.hooks.preSystemPrompt ?? [];
    let extraInstructions = "";
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `preSystemPrompt[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(params, this.ctx),
        {},
      );
      if (result.extraInstructions) {
        if (extraInstructions) extraInstructions += "\n";
        extraInstructions += result.extraInstructions;
      }
    }
    return extraInstructions ? { extraInstructions } : {};
  }

  // ── PreLlmTurn ───────────────────────────────

  async runPreLlmTurn(
    params: PreLlmTurnParams,
  ): Promise<PreLlmTurnResult> {
    const hooks = this.hooks.preLlmTurn ?? [];
    const allMessages: ModelMessage[] = [];
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `preLlmTurn[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(params, this.ctx),
        {},
      );
      if (result.extraMessages) {
        allMessages.push(...result.extraMessages);
      }
    }
    return allMessages.length > 0 ? { extraMessages: allMessages } : {};
  }

  // ── PostLlmTurn ──────────────────────────────

  async runPostLlmTurn(
    params: PostLlmTurnParams,
  ): Promise<PostLlmTurnResult> {
    const hooks = this.hooks.postLlmTurn ?? [];
    let finalText: string | undefined;
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `postLlmTurn[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(params, this.ctx),
        {},
      );
      if (result.text !== undefined) {
        finalText = result.text; // last hook wins
      }
    }
    return finalText !== undefined ? { text: finalText } : {};
  }

  // ── PreTool ──────────────────────────────────

  async runPreTool(params: PreToolParams): Promise<PreToolResult> {
    const hooks = this.hooks.preTool ?? [];
    let command = params.command;
    let timeoutMs = params.timeoutMs;
    const extraEnv: Record<string, string> = {};

    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `preTool[${i}]`,
        this.ctx.logger,
        () => hooks[i]!({ command, timeoutMs, env: params.env }, this.ctx),
        {},
      );
      if (result.action === "abort") {
        return { action: "abort", abortError: result.abortError ?? "Hook aborted bash tool" };
      }
      if (result.command !== undefined) {
        command = result.command;
      }
      if (result.timeoutMs !== undefined) {
        timeoutMs = Math.min(timeoutMs, result.timeoutMs);
      }
      if (result.extraEnv) {
        Object.assign(extraEnv, result.extraEnv);
      }
    }

    return {
      command: command !== params.command ? command : undefined,
      timeoutMs: timeoutMs !== params.timeoutMs ? timeoutMs : undefined,
      extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
      action: "continue",
    };
  }

  // ── PostTool ─────────────────────────────────

  async runPostTool(entry: BashEntry): Promise<PostToolResult> {
    const hooks = this.hooks.postTool ?? [];
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `postTool[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(entry, this.ctx),
        { action: "continue" } as PostToolResult,
      );
      if (result.action === "abort") {
        return result;
      }
    }
    return { action: "continue" };
  }

  // ── PreVerdict ───────────────────────────────

  async runPreVerdict(
    params: PreVerdictParams,
  ): Promise<PreVerdictResult> {
    const hooks = this.hooks.preVerdict ?? [];
    let finalText: string | undefined;
    for (let i = 0; i < hooks.length; i++) {
      const result = await safeCall(
        `preVerdict[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(params, this.ctx),
        {},
      );
      if (result.finalText !== undefined) {
        finalText = result.finalText; // last hook wins
      }
    }
    return finalText !== undefined ? { finalText } : {};
  }

  // ── PostScenario ─────────────────────────────

  async runPostScenario(
    result: ScenarioResult,
  ): Promise<PostScenarioResult> {
    const hooks = this.hooks.postScenario ?? [];
    let mergedResult: Partial<ScenarioResult> = {};
    for (let i = 0; i < hooks.length; i++) {
      const hookResult = await safeCall(
        `postScenario[${i}]`,
        this.ctx.logger,
        () => hooks[i]!(result, this.ctx),
        {},
      );
      if (hookResult.result) {
        mergedResult = { ...mergedResult, ...hookResult.result };
      }
    }
    return Object.keys(mergedResult).length > 0
      ? { result: mergedResult }
      : {};
  }
}

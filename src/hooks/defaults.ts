import type { ExtensionHooks } from "../types/hooks.js";
import { ensureProfilesBatchHook } from "./ensure-profiles-batch.js";
import { resolveProfileHook } from "./resolve-profile.js";

export const defaultExtensionHooks = {
  preBatch: [ensureProfilesBatchHook],
  preScenario: [resolveProfileHook],
} satisfies ExtensionHooks;

export type MergeExtensionHooksMode = "append" | "replace";

function mergeHookSlot<T>(
  base: T[] | undefined,
  override: T[] | undefined,
  mode: MergeExtensionHooksMode,
): T[] | undefined {
  if (!override || override.length === 0) return base;
  if (mode === "replace" || !base || base.length === 0) return [...override];
  return [...base, ...override];
}

export function mergeExtensionHooks(
  base: ExtensionHooks,
  override: ExtensionHooks,
  mode: MergeExtensionHooksMode = "append",
): ExtensionHooks {
  return {
    preBatch: mergeHookSlot(base.preBatch, override.preBatch, mode),
    postBatch: mergeHookSlot(base.postBatch, override.postBatch, mode),
    preScenario: mergeHookSlot(base.preScenario, override.preScenario, mode),
    preSystemPrompt: mergeHookSlot(
      base.preSystemPrompt,
      override.preSystemPrompt,
      mode,
    ),
    preLlmTurn: mergeHookSlot(base.preLlmTurn, override.preLlmTurn, mode),
    postLlmTurn: mergeHookSlot(base.postLlmTurn, override.postLlmTurn, mode),
    preTool: mergeHookSlot(base.preTool, override.preTool, mode),
    postTool: mergeHookSlot(base.postTool, override.postTool, mode),
    preVerdict: mergeHookSlot(base.preVerdict, override.preVerdict, mode),
    postScenario: mergeHookSlot(base.postScenario, override.postScenario, mode),
  };
}

export { ensureProfilesBatchHook } from "./ensure-profiles-batch.js";
export { resolveProfileHook } from "./resolve-profile.js";

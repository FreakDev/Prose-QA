import type { ModelMessage } from "ai";
import { resolveAgentGuardConfig } from "../config/load.js";
import {
  buildGuardNudgeMessage,
  buildSyntheticGuardVerdict,
  evaluateRunGuard,
  isRunGuardEnabled,
  RunGuardSyntheticFailError,
  type RunGuardMetadata,
} from "../agent/run-guard.js";
import type {
  HookContext,
  PostToolHook,
  PostToolResult,
  PreLlmTurnHook,
} from "../types/hooks.js";
import type { BashEntry } from "../types/verdict.js";
import type { Scenario } from "../types/scenario.js";

function getScenario(metadata: Record<string, unknown>): Scenario {
  const scenario = metadata.scenario;
  if (!scenario || typeof scenario !== "object") {
    throw new Error("Run guard hook requires metadata.scenario");
  }
  return scenario as Scenario;
}

function getGuardMetadata(metadata: Record<string, unknown>): RunGuardMetadata {
  return metadata as RunGuardMetadata;
}

export const runGuardPreLlmTurnHook: PreLlmTurnHook = async (_params, ctx) => {
  if (!isRunGuardEnabled(ctx.config)) return {};

  const metadata = getGuardMetadata(ctx.metadata);
  const evaluation = evaluateRunGuard({
    transcript: ctx.transcript,
    config: ctx.config,
    metadata,
  });

  if (evaluation.level !== "nudge" || metadata.guardNudgeSent) {
    return {};
  }

  metadata.guardNudgeSent = true;
  const guard = resolveAgentGuardConfig(ctx.config);
  const message = buildGuardNudgeMessage(
    evaluation.failedCount,
    guard.maxFailedToolCalls,
  );
  const extraMessages: ModelMessage[] = [{ role: "user", content: message }];
  return { extraMessages };
};

export const runGuardPostToolHook: PostToolHook = async (
  entry: BashEntry,
  ctx: HookContext,
): Promise<PostToolResult> => {
  if (!isRunGuardEnabled(ctx.config)) {
    return { action: "continue" };
  }

  const metadata = getGuardMetadata(ctx.metadata);
  const evaluation = evaluateRunGuard({
    transcript: ctx.transcript,
    config: ctx.config,
    metadata,
    currentEntry: entry,
  });

  if (evaluation.level !== "abort") {
    return { action: "continue" };
  }

  const guard = resolveAgentGuardConfig(ctx.config);
  throw new RunGuardSyntheticFailError(
    buildSyntheticGuardVerdict(
      getScenario(ctx.metadata),
      evaluation.failedCount,
      guard.maxFailedToolCalls,
      ctx.transcript,
    ),
  );
};

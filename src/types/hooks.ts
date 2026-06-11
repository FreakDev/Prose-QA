import type { ModelMessage } from "ai";
import type { PqaConfig } from "./config.js";
import type { Scenario } from "./scenario.js";
import type { Skill } from "./skill.js";
import type {
  AgentTranscript,
  BashEntry,
  ScenarioResult,
} from "./verdict.js";

// ──────────────────────────────────────────────
// HookContext
// ──────────────────────────────────────────────

export interface HookContext {
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  cwd: string;
  config: PqaConfig;
  transcript: AgentTranscript;
  metadata: Record<string, unknown>;
  abort: (reason: string) => never;
}

// ──────────────────────────────────────────────
// PreScenario
// ──────────────────────────────────────────────

export interface ProfileBrowserContext {
  profilePath?: string;
  authStatePath?: string;
}

export interface PreScenarioResultContinue {
  action: "continue";
  browserContext?: ProfileBrowserContext;
}

export interface PreScenarioResultSkip {
  action: "skip";
  reason: string;
}

export interface PreScenarioResultAbort {
  action: "abort";
  error: string;
}

export type PreScenarioResult =
  | PreScenarioResultContinue
  | PreScenarioResultSkip
  | PreScenarioResultAbort;

export type PreScenarioHook = (
  scenario: Scenario,
  ctx: HookContext,
) => PreScenarioResult | Promise<PreScenarioResult>;

// ──────────────────────────────────────────────
// PreSystemPrompt
// ──────────────────────────────────────────────

export interface PreSystemPromptParams {
  config: PqaConfig;
  skills: Skill[];
  scenario: Scenario;
  runtime: {
    cwd: string;
    artifactDir: string;
    headed: boolean;
    sessionName: string;
    artifacts: string;
    scenarioCacheHints?: string;
    preparedStartUrl?: string;
  };
}

export interface PreSystemPromptResult {
  extraInstructions?: string;
}

export type PreSystemPromptHook = (
  params: PreSystemPromptParams,
  ctx: HookContext,
) => PreSystemPromptResult | Promise<PreSystemPromptResult>;

// ──────────────────────────────────────────────
// PreLlmTurn
// ──────────────────────────────────────────────

export interface PreLlmTurnParams {
  messages: ModelMessage[];
  turn: number;
  maxTurns: number;
}

export interface PreLlmTurnResult {
  extraMessages?: ModelMessage[];
}

export type PreLlmTurnHook = (
  params: PreLlmTurnParams,
  ctx: HookContext,
) => PreLlmTurnResult | Promise<PreLlmTurnResult>;

// ──────────────────────────────────────────────
// PostLlmTurn
// ──────────────────────────────────────────────

export interface PostLlmTurnParams {
  text: string;
  reasoningText?: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  turn: number;
  durationMs: number;
}

export interface PostLlmTurnResult {
  text?: string;
}

export type PostLlmTurnHook = (
  params: PostLlmTurnParams,
  ctx: HookContext,
) => PostLlmTurnResult | Promise<PostLlmTurnResult>;

// ──────────────────────────────────────────────
// PreTool
// ──────────────────────────────────────────────

export interface PreToolParams {
  command: string;
  timeoutMs: number;
  env: Record<string, string>;
}

export interface PreToolResult {
  command?: string;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
  action?: "continue" | "abort";
  abortError?: string;
}

export type PreToolHook = (
  params: PreToolParams,
  ctx: HookContext,
) => PreToolResult | Promise<PreToolResult>;

// ──────────────────────────────────────────────
// PostTool
// ──────────────────────────────────────────────

export interface PostToolResultContinue {
  action: "continue";
}

export interface PostToolResultAbort {
  action: "abort";
  error: string;
}

export type PostToolResult = PostToolResultContinue | PostToolResultAbort;

export type PostToolHook = (
  entry: BashEntry,
  ctx: HookContext,
) => PostToolResult | Promise<PostToolResult>;

// ──────────────────────────────────────────────
// PreVerdict
// ──────────────────────────────────────────────

export interface PreVerdictParams {
  finalText: string;
  transcript: AgentTranscript;
}

export interface PreVerdictResult {
  finalText?: string;
}

export type PreVerdictHook = (
  params: PreVerdictParams,
  ctx: HookContext,
) => PreVerdictResult | Promise<PreVerdictResult>;

// ──────────────────────────────────────────────
// PostScenario
// ──────────────────────────────────────────────

export interface PostScenarioResult {
  result?: Partial<ScenarioResult>;
}

export type PostScenarioHook = (
  result: ScenarioResult,
  ctx: HookContext,
) => PostScenarioResult | Promise<PostScenarioResult>;

// ──────────────────────────────────────────────
// PreBatch
// ──────────────────────────────────────────────

export type BatchEntrypoint = "run" | "worker" | "mcp";

export interface BatchScenarioSummary {
  name: string;
  auth?: string;
}

export interface PreBatchParams {
  runId: string;
  runDir: string;
  entrypoint: BatchEntrypoint;
  scenarios: BatchScenarioSummary[];
  requiredProfiles: string[];
  authRefresh?: boolean;
}

export interface PreBatchResultContinue {
  action: "continue";
}

export interface PreBatchResultAbort {
  action: "abort";
  error: string;
}

export type PreBatchResult = PreBatchResultContinue | PreBatchResultAbort;

export type PreBatchHook = (
  params: PreBatchParams,
  ctx: HookContext,
) => PreBatchResult | Promise<PreBatchResult>;

// ──────────────────────────────────────────────
// PostBatch
// ──────────────────────────────────────────────

export type BatchStatus = "pass" | "fail" | "error";

export interface PostBatchParams {
  runId: string;
  runDir: string;
  entrypoint: BatchEntrypoint;
  scenarios: BatchScenarioSummary[];
  requiredProfiles: string[];
  results: ScenarioResult[];
  status: BatchStatus;
}

export interface PostBatchResultContinue {
  action: "continue";
}

export interface PostBatchResultAbort {
  action: "abort";
  error: string;
}

export type PostBatchResult = PostBatchResultContinue | PostBatchResultAbort;

export type PostBatchHook = (
  params: PostBatchParams,
  ctx: HookContext,
) => PostBatchResult | Promise<PostBatchResult>;

// ──────────────────────────────────────────────
// Aggregate ExtensionHooks
// ──────────────────────────────────────────────

export interface ExtensionHooks {
  preBatch?: PreBatchHook[];
  postBatch?: PostBatchHook[];
  preScenario?: PreScenarioHook[];
  preSystemPrompt?: PreSystemPromptHook[];
  preLlmTurn?: PreLlmTurnHook[];
  postLlmTurn?: PostLlmTurnHook[];
  preTool?: PreToolHook[];
  postTool?: PostToolHook[];
  preVerdict?: PreVerdictHook[];
  postScenario?: PostScenarioHook[];
}

// ──────────────────────────────────────────────
// Type guards
// ──────────────────────────────────────────────

export function isPreScenarioResult(o: unknown): o is PreScenarioResult {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.action === "string" &&
    ["continue", "skip", "abort"].includes(r.action)
  );
}

export function isPostToolResult(o: unknown): o is PostToolResult {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.action === "string" && ["continue", "abort"].includes(r.action)
  );
}

export function isHookContext(o: unknown): o is HookContext {
  if (typeof o !== "object" || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.logger === "object" &&
    r.logger !== null &&
    typeof (r.logger as Record<string, unknown>).info === "function" &&
    typeof (r.logger as Record<string, unknown>).error === "function" &&
    typeof r.cwd === "string" &&
    typeof r.abort === "function"
  );
}

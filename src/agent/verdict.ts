import type { LanguageModelUsage, ModelMessage } from "ai";
import {
  VerdictSchema,
  type AgentTranscript,
  type BashEntry,
  type HealingMeta,
  type ParsedVerdict,
  type TokenUsageStats,
  type TranscriptBashEntry,
  type TranscriptMessageEntry,
  type Verdict,
  type VerdictStats,
} from "../types/verdict.js";

export function emptyTokenUsage(): TokenUsageStats {
  return { input: 0, output: 0 };
}

function cachedTokensFromUsage(usage: LanguageModelUsage): number | undefined {
  return (
    usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens
  );
}

export function addLanguageModelUsage(
  acc: TokenUsageStats,
  usage: LanguageModelUsage | undefined,
): TokenUsageStats {
  if (!usage) return acc;

  const next: TokenUsageStats = {
    input: acc.input + (usage.inputTokens ?? 0),
    output: acc.output + (usage.outputTokens ?? 0),
  };
  const stepCached = cachedTokensFromUsage(usage);
  if (stepCached !== undefined) {
    next.cached = (acc.cached ?? 0) + stepCached;
  } else if (acc.cached !== undefined) {
    next.cached = acc.cached;
  }
  return next;
}

/** Drop the last assistant turn (and trailing tool results) so the model can redo that completion. */
export function stripLastAssistantTurn(messages: ModelMessage[]): ModelMessage[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1]?.role === "tool") {
    end -= 1;
  }
  if (end > 0 && messages[end - 1]?.role === "assistant") {
    return messages.slice(0, end - 1);
  }
  return messages;
}

export function extractVerdict(text: string): ParsedVerdict | null {
  const jsonBlock = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  const candidates: string[] = [];

  while ((match = jsonBlock.exec(text)) !== null) {
    candidates.push(match[1]!.trim());
  }

  // Also try parsing the whole text as JSON
  candidates.push(text.trim());

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const result = VerdictSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // continue
    }
  }

  // Try to find inline JSON object with status field
  const inline = /\{[\s\S]*"status"\s*:\s*"(?:pass|fail)"[\s\S]*\}/.exec(text);
  if (inline) {
    try {
      const parsed = JSON.parse(inline[0]) as unknown;
      const result = VerdictSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // continue
    }
  }

  return null;
}

export interface TranscriptStatsOptions {
  durationMs?: number;
  healing?: HealingMeta;
  tokens?: TokenUsageStats;
}

export function computeTranscriptStats(
  transcript: AgentTranscript,
  options: TranscriptStatsOptions = {},
): VerdictStats {
  let llmTurns = 0;
  let userTurns = 0;
  let toolCalls = 0;
  let failedToolCalls = 0;
  let llmDurationMs = 0;
  let bashDurationMs = 0;

  for (const entry of transcript.entries) {
    if (entry.type === "message") {
      if (entry.role === "assistant") {
        llmTurns += 1;
        llmDurationMs += entry.durationMs ?? 0;
      } else if (entry.role === "user") {
        userTurns += 1;
      }
      continue;
    }

    toolCalls += 1;
    bashDurationMs += entry.durationMs;
    if (entry.exitCode !== 0) failedToolCalls += 1;
  }

  const stats: VerdictStats = {
    durationMs: options.durationMs ?? llmDurationMs + bashDurationMs,
    llmTurns,
    userTurns,
    toolCalls,
    failedToolCalls,
    llmDurationMs,
    bashDurationMs,
  };

  if (options.healing) {
    stats.healing = {
      used: options.healing.used,
      recoveryTurns: options.healing.recoveryTurns,
      scenarioRetries: options.healing.scenarioRetries,
    };
  }

  if (
    options.tokens &&
    (options.tokens.input > 0 ||
      options.tokens.output > 0 ||
      (options.tokens.cached ?? 0) > 0)
  ) {
    stats.tokens = options.tokens;
  }

  return stats;
}

export function enrichVerdictWithStats(
  verdict: ParsedVerdict | Verdict | null,
  transcript: AgentTranscript,
  options: TranscriptStatsOptions = {},
): Verdict | null {
  if (!verdict) return null;
  const existingTokens = "stats" in verdict ? verdict.stats?.tokens : undefined;
  return {
    ...verdict,
    stats: computeTranscriptStats(transcript, {
      ...options,
      tokens: options.tokens ?? existingTokens,
    }),
  };
}

export function getTranscriptMessages(
  transcript: AgentTranscript,
): TranscriptMessageEntry[] {
  return transcript.entries.filter(
    (entry): entry is TranscriptMessageEntry => entry.type === "message",
  );
}

export function getTranscriptBashEntries(
  transcript: AgentTranscript,
): TranscriptBashEntry[] {
  return transcript.entries.filter(
    (entry): entry is TranscriptBashEntry => entry.type === "bash",
  );
}

function getLastAssistantMessageEntry(
  transcript: AgentTranscript,
): TranscriptMessageEntry | undefined {
  for (let i = transcript.entries.length - 1; i >= 0; i -= 1) {
    const entry = transcript.entries[i]!;
    if (entry.type === "message" && entry.role === "assistant") return entry;
    if (entry.type === "message" && entry.role === "user") break;
  }
  return undefined;
}

export interface TranscriptEntryTiming {
  at?: Date;
  durationMs?: number;
}

export function appendTranscriptMessage(
  transcript: AgentTranscript,
  role: string,
  content: string,
  thinking?: string,
  timing?: TranscriptEntryTiming,
): void {
  const entry: TranscriptMessageEntry = {
    type: "message",
    role,
    thinking,
    content,
    at: (timing?.at ?? new Date()).toISOString(),
    ...(timing?.durationMs !== undefined ? { durationMs: timing.durationMs } : {}),
  };
  transcript.entries.push(entry);
}

export function appendTranscriptBash(
  transcript: AgentTranscript,
  entry: BashEntry,
  timing?: Pick<TranscriptEntryTiming, "at">,
): void {
  transcript.entries.push({
    type: "bash",
    ...entry,
    at: (timing?.at ?? new Date()).toISOString(),
  });
}

/** Append final model text when it is not already the last assistant message. */
export function appendFinalTextToTranscript(
  transcript: AgentTranscript,
  finalText: string,
  timing?: TranscriptEntryTiming,
): void {
  if (!finalText) return;
  const last = getLastAssistantMessageEntry(transcript);
  if (last?.content === finalText) return;
  appendTranscriptMessage(transcript, "assistant", finalText, undefined, timing);
}

export interface StepTranscriptInput {
  text: string;
  reasoningText?: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
}

export interface StepTranscriptFormatted {
  content: string | null;
  thinking?: string;
}

/** Format one LLM step for the transcript (content, thinking, and tool calls). */
export function formatStepForTranscript(
  step: StepTranscriptInput,
): StepTranscriptFormatted {
  const contentParts: string[] = [];
  if (step.text) contentParts.push(step.text);
  for (const call of step.toolCalls) {
    const input =
      typeof call.input === "string"
        ? call.input
        : JSON.stringify(call.input);
    contentParts.push(`[tool ${call.toolName}] ${input}`);
  }
  const content =
    contentParts.length > 0 ? contentParts.join("\n\n") : null;
  const result: StepTranscriptFormatted = { content };
  const thinking = step.reasoningText?.trim();
  if (thinking) result.thinking = thinking;
  return result;
}

export function appendStepToTranscript(
  transcript: AgentTranscript,
  step: StepTranscriptInput,
  bashEntries: BashEntry[] = [],
  formattedOverride?: StepTranscriptFormatted,
  timing?: TranscriptEntryTiming,
): boolean {
  let changed = false;
  const formatted = formattedOverride ?? formatStepForTranscript(step);
  const recordedAt = timing?.at ?? new Date();
  if (formatted.content || formatted.thinking) {
    appendTranscriptMessage(
      transcript,
      "assistant",
      formatted.content ?? "",
      formatted.thinking,
      { at: recordedAt, durationMs: timing?.durationMs },
    );
    changed = true;
  }
  for (const entry of bashEntries) {
    appendTranscriptBash(transcript, entry, { at: recordedAt });
    changed = true;
  }
  return changed;
}

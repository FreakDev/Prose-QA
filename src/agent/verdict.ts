import type { ModelMessage } from "ai";
import {
  VerdictSchema,
  type AgentTranscript,
  type BashEntry,
  type TranscriptBashEntry,
  type TranscriptMessageEntry,
  type Verdict,
} from "../types/verdict.js";

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

export function extractVerdict(text: string): Verdict | null {
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

export function appendTranscriptMessage(
  transcript: AgentTranscript,
  role: string,
  content: string,
  thinking?: string,
): void {
  const entry: TranscriptMessageEntry = { type: "message", role, thinking, content };
  transcript.entries.push(entry);
}

export function appendTranscriptBash(
  transcript: AgentTranscript,
  entry: BashEntry,
): void {
  transcript.entries.push({ type: "bash", ...entry });
}

/** Append final model text when it is not already the last assistant message. */
export function appendFinalTextToTranscript(
  transcript: AgentTranscript,
  finalText: string,
): void {
  if (!finalText) return;
  const last = getLastAssistantMessageEntry(transcript);
  if (last?.content === finalText) return;
  appendTranscriptMessage(transcript, "assistant", finalText);
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
): boolean {
  let changed = false;
  const formatted = formattedOverride ?? formatStepForTranscript(step);
  if (formatted.content || formatted.thinking) {
    appendTranscriptMessage(
      transcript,
      "assistant",
      formatted.content ?? "",
      formatted.thinking,
    );
    changed = true;
  }
  for (const entry of bashEntries) {
    appendTranscriptBash(transcript, entry);
    changed = true;
  }
  return changed;
}

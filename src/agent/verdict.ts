import { VerdictSchema, type AgentTranscript, type Verdict } from "../types/verdict.js";

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

export function appendTranscriptMessage(
  transcript: AgentTranscript,
  role: string,
  content: string,
): void {
  transcript.messages.push({ role, content });
}

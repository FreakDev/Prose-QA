import { z } from "zod";

export const CheckpointResultSchema = z.object({
  assertion: z.string(),
  pass: z.boolean(),
  reason: z.string(),
  evidence: z.array(z.string()).optional(),
});

export const VerdictSchema = z.object({
  status: z.enum(["pass", "fail"]),
  checkpoints: z.array(CheckpointResultSchema),
  summary: z.string(),
});

export type CheckpointResult = z.infer<typeof CheckpointResultSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;

export type FailureKind = "transient" | "scenario_issue" | "product" | "unknown";

export interface HealingMeta {
  used: boolean;
  recoveryTurns: number;
  scenarioRetries: number;
  failureKind?: FailureKind;
  signals?: string[];
}

export interface BashEntry {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface TranscriptMessageEntry {
  type: "message";
  role: string;
  /** Extended thinking / reasoning from the LLM, when available. */
  thinking?: string;
  content: string;
  /** ISO-8601 timestamp when this entry was recorded. */
  at: string;
  /** Wall-clock duration of the LLM step (ms), for assistant messages only. */
  durationMs?: number;
}

export interface TranscriptBashEntry extends BashEntry {
  type: "bash";
  /** ISO-8601 timestamp when this entry was recorded. */
  at: string;
}

export type TranscriptEntry = TranscriptMessageEntry | TranscriptBashEntry;

export interface AgentTranscript {
  entries: TranscriptEntry[];
}

export interface ScenarioResult {
  scenario: string;
  filePath: string;
  status: "pass" | "fail" | "error" | "skipped";
  durationMs: number;
  verdict: Verdict | null;
  transcript: AgentTranscript;
  error?: string;
  artifactDir?: string;
  healing?: HealingMeta;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
  };
}

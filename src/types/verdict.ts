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

export interface BashEntry {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface AgentTranscript {
  messages: Array<{ role: string; content: string }>;
  bash: BashEntry[];
}

export interface ScenarioResult {
  scenario: string;
  filePath: string;
  status: "pass" | "fail" | "error";
  durationMs: number;
  verdict: Verdict | null;
  transcript: AgentTranscript;
  error?: string;
  artifactDir?: string;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  results: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
  };
}

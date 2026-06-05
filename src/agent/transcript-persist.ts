import { writeTranscript } from "../reporter/index.js";
import type { EnvRedactor } from "../redact/env-secrets.js";
import type { AgentTranscript } from "../types/verdict.js";

export interface PersistTranscriptOptions {
  artifactDir: string;
  redactor?: EnvRedactor;
}

/** Write the in-memory transcript to disk (incremental, not gated on verbose). */
export function persistTranscript(
  options: PersistTranscriptOptions,
  transcript: AgentTranscript,
): void {
  writeTranscript(options.artifactDir, transcript, options.redactor);
}

import type {
  AgentTranscript,
  BashEntry,
  ScenarioResult,
  Verdict,
} from "../types/verdict.js";

const DEFAULT_MIN_REDACT_LENGTH = 4;

interface Replacement {
  value: string;
  placeholder: string;
}

export interface EnvRedactorOptions {
  minRedactLength?: number;
}

export interface EnvRedactor {
  redact(text: string): string;
  redactBashEntry(entry: BashEntry): BashEntry;
  redactTranscript(transcript: AgentTranscript): AgentTranscript;
  redactVerdict(verdict: Verdict | null): Verdict | null;
  redactScenarioResult(result: ScenarioResult): ScenarioResult;
}

function buildReplacements(
  env: NodeJS.ProcessEnv,
  sensitiveNames: string[],
  minRedactLength: number,
): Replacement[] {
  const valueToPlaceholder = new Map<string, string>();

  for (const name of [...sensitiveNames].sort()) {
    const value = env[name];
    if (!value || value.length < minRedactLength) continue;
    if (!valueToPlaceholder.has(value)) {
      valueToPlaceholder.set(value, `\${${name}}`);
    }
  }

  return [...valueToPlaceholder.entries()]
    .map(([value, placeholder]) => ({ value, placeholder }))
    .sort(
      (a, b) =>
        b.value.length - a.value.length ||
        a.placeholder.localeCompare(b.placeholder),
    );
}

export function createEnvRedactor(
  env: NodeJS.ProcessEnv,
  sensitiveNames: string[],
  options: EnvRedactorOptions = {},
): EnvRedactor {
  const minRedactLength = options.minRedactLength ?? DEFAULT_MIN_REDACT_LENGTH;
  const replacements = buildReplacements(env, sensitiveNames, minRedactLength);

  function redact(text: string): string {
    if (replacements.length === 0) return text;
    let out = text;
    for (const { value, placeholder } of replacements) {
      out = out.split(value).join(placeholder);
    }
    return out;
  }

  function redactBashEntry(entry: BashEntry): BashEntry {
    return {
      ...entry,
      command: redact(entry.command),
      stdout: redact(entry.stdout),
      stderr: redact(entry.stderr),
    };
  }

  function redactTranscript(transcript: AgentTranscript): AgentTranscript {
    return {
      entries: transcript.entries.map((entry) => {
        if (entry.type === "message") {
          return {
            type: "message" as const,
            role: entry.role,
            content: redact(entry.content),
            at: entry.at,
            ...(entry.thinking ? { thinking: redact(entry.thinking) } : {}),
            ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
          };
        }
        return { type: "bash" as const, ...redactBashEntry(entry), at: entry.at };
      }),
    };
  }

  function redactVerdict(verdict: Verdict | null): Verdict | null {
    if (!verdict) return null;
    return {
      ...verdict,
      summary: redact(verdict.summary),
      checkpoints: verdict.checkpoints.map((c) => ({
        ...c,
        reason: redact(c.reason),
        evidence: c.evidence?.map(redact),
      })),
      ...(verdict.stats ? { stats: verdict.stats } : {}),
    };
  }

  function redactScenarioResult(result: ScenarioResult): ScenarioResult {
    return {
      ...result,
      transcript: redactTranscript(result.transcript),
      verdict: redactVerdict(result.verdict),
      error: result.error ? redact(result.error) : undefined,
    };
  }

  return {
    redact,
    redactBashEntry,
    redactTranscript,
    redactVerdict,
    redactScenarioResult,
  };
}

export function createNoOpRedactor(): EnvRedactor {
  return createEnvRedactor({}, []);
}

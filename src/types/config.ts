export interface HealingConfig {
  /** Master switch. Default: true */
  enabled?: boolean;
  /** Extra agent turns after a failed verdict (same session). Default: 2 */
  maxRecoveryTurns?: number;
  /** Regex strings matched against bash output + checkpoint reasons */
  transientPatterns?: string[];
  /** If true, allow recovery when class is unknown but bash looks transient. Default: false */
  recoverOnUnknown?: boolean;
}

export interface RecorderConfig {
  bridgePort?: number;
  outputDir?: string;
  defaultTags?: string[];
}

/** Reasoning intensity; applied only on providers that support it (e.g. OpenAI, Anthropic, Google). */
export type LlmReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface PqaConfig {
  /** Root directory for scenario markdown files. Default: scenarios (or pqa if present). */
  scenariosDir?: string;
  systemPromptPath?: string;
  /** Env var names injected into the system prompt and expected at runtime */
  envVars?: string[];
  /** Env var names whose values are redacted from transcripts, verdicts, reports and verbose logs */
  sensitiveEnvVars?: string[];
  llm: {
    provider: "anthropic" | "openai" | "fireworks" | "ollama" | "google";
    model: string;
    /**
     * Extended thinking / reasoning (opt-in).
     * `budgetTokens`: Anthropic, Fireworks & Google thinking budget.
     * `reasoningEffort`: OpenAI reasoning effort; Anthropic effort; Google thinking level (mapped).
     * Ollama: `think` only (other fields ignored).
     */
    thinking?: {
      enabled: boolean;
      budgetTokens?: number;
      reasoningEffort?: LlmReasoningEffort;
    };
  };
  browser: {
    headed: boolean;
    sessionName: string;
    defaultTimeout: number;
  };
  skills: {
    dirs: string[];
    preloads: string[];
  };
  agent: {
    maxTurns: number;
    bashTimeoutMs: number;
  };
  auth: Record<string, AuthProfileConfig>;
  healing?: HealingConfig;
  recorder?: RecorderConfig;
}

export interface AuthProfileConfig {
  /** frontmatter.name of the on-demand auth scenario */
  scenario?: string;
  /** agent-browser state file; defaults to .pqa/auth/<profile>.json */
  statePath?: string;
}

export type ArtifactsMode = "on-failure" | "always" | "never";

export interface RunOptions {
  configPath?: string;
  tags?: string[];
  retries?: number;
  artifacts: ArtifactsMode;
  headed?: boolean;
  verbose?: boolean;
  pause?: boolean;
  skillsDirs?: string[];
  parallel?: number;
  /** Stop remaining scenarios on first failure (default: false) */
  failFast?: boolean;
  authRefresh?: boolean;
  /** Keep browser open after each scenario (debug only). Default: close after each scenario. */
  keepBrowser?: boolean;
  /** Disable in-run recovery and transient-only retry gating */
  noHealing?: boolean;
  /** When healing is enabled, retry only transient failures unless "always" */
  retriesPolicy?: "transient" | "always";
}

export interface SkillsLock {
  "agent-browser": {
    npmVersion: string;
    skillName: string;
    syncedAt: string;
    checksum: string;
  };
}

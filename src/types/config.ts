export interface SaqConfig {
  baseUrl: string;
  systemPromptPath?: string;
  llm: {
    provider: "anthropic" | "openai" | "fireworks";
    model: string;
  };
  browser: {
    headed: boolean;
    sessionName: string;
    defaultTimeout: number;
  };
  skills: {
    dirs: string[];
    preloads: string[];
    activate: string[];
  };
  agent: {
    maxTurns: number;
    bashTimeoutMs: number;
  };
  auth: Record<string, { statePath: string }>;
}

export interface RunOptions {
  baseUrl?: string;
  configPath?: string;
  tags?: string[];
  retries?: number;
  artifacts: "on-failure" | "always" | "never";
  headed?: boolean;
  verbose?: boolean;
  pause?: boolean;
  skillsDirs?: string[];
}

export interface SkillsLock {
  "agent-browser": {
    npmVersion: string;
    skillName: string;
    syncedAt: string;
    checksum: string;
  };
}

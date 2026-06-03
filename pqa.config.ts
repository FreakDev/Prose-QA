/**
 * Default Prose-QA configuration.
 * Used when no pqa.config.* exists in the project cwd (e.g. pilar-ui).
 * Override locally by adding pqa.config.json (or .mjs / .ts / .js) in your project root.
 */
const config = {
  scenariosDir: "scenarios",
  llm: {
    provider:
      (process.env.PQA_LLM_PROVIDER as
        | "anthropic"
        | "openai"
        | "fireworks"
        | "ollama"
        | "google"
        | "openrouter") ??
      "anthropic",
    model:
      process.env.PQA_LLM_MODEL ??
      "claude-sonnet-4-20250514",
    thinking: {
      enabled: true,
      budgetTokens: 10_000,
    },
  },
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
  },
  systemPromptPath: "prompt/SYSTEM.md",
  envVars: [],
  sensitiveEnvVars: [],
  skills: {
    dirs: ["skills", ".agents/skills"],
    preloads: ["core"],
  },
  agent: {
    maxTurns: 200,
    bashTimeoutMs: 120_000,
  },
  auth: {
    admin: {
      scenario: "login-admin",
    },
  },
  healing: {
    enabled: true,
    maxRecoveryTurns: 2,
    recoverOnUnknown: false,
    transientPatterns: [
      "timeout",
      "timed out",
      "not found",
      "waiting for",
      "navigation",
      "net::",
      "target closed",
      "detached",
      "stale",
      "interrupted",
    ],
  },
  recorder: {
    bridgePort: 17_321,
    outputDir: ".pqa/recordings",
    defaultTags: ["recorded"],
  },
  cache: {
    dir: ".pqa/cache",
    enabled: true,
  },
  report: {
    outputPath: "",
    zip: false,
  },
};

export default config;

/**
 * Default Prose-QA configuration.
 * Used when no pqa.config.* exists in the project cwd (e.g. pilar-ui).
 * Override locally by adding pqa.config.json (or .mjs / .ts / .js) in your project root.
 */
const config = {
  scenariosDir: "scenarios",
  llm: {
    thinking: {
      enabled: true,
      budgetTokens: 10_000,
    },
  },
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine: "chrome",
    lightpanda: {
      executablePath: "./bin",
      telemetry: false,
    },
  },
  systemPromptPath: "prompt/SYSTEM.md",
  envVars: [],
  sensitiveEnvVars: [],
  skills: {
    dirs: ["skills"],
    preloads: ["core"],
  },
  agent: {
    parallel: 0,
    maxTurns: 300,
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

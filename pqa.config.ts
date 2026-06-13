/**
 * Default Prose-QA configuration.
 * Used when no pqa.config.* exists in the project cwd (e.g. pilar-ui).
 * Override locally by adding pqa.config.json (or .mjs / .ts / .js) in your project root.
 */
import { defaultExtensionHooks } from "./dist/hooks/defaults.js";

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
      executablePath: "./.pqa/engine",
      telemetry: false,
    },
  },
  envVars: [],
  sensitiveEnvVars: [],
  skills: {
    dirs: [".pqa/skills"],
    preloads: [],
    onDemand: {
      enabled: true,
      autoLoad: true,
      maxChars: 50_000,
    },
  },
  auth: {
    admin: {
      scenario: "login-admin",
    },
  },
  agent: {
    parallel: 0,
    maxTurns: 80,
    bashTimeoutMs: 60_000,
    guard: {
      nudgeFailedToolCalls: 5,
      maxFailedToolCalls: 8,
      maxRecoverySteps: 5,
    },
  },
  healing: {
    enabled: true,
    maxRecoveryTurns: 2,
    recoverOnUnknown: false,
    transientPatterns: [
      "timeout",
      "timed out",
      "waiting for",
      "navigation",
      "net::",
      "detached",
      "stale",
      "interrupted",
      "networkidle",
    ],
  },
  browserHealth: {
    circuitBreakerThreshold: 3,
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
  extensions: {
    hooks: defaultExtensionHooks,
  },
};

export default config;

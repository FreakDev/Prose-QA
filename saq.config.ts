import type { SaqConfig } from "./src/types/config.js";

const config: SaqConfig = {
  baseUrl: process.env.SAQ_BASE_URL ?? "http://localhost:3000",
  llm: {
    provider:
      (process.env.SAQ_LLM_PROVIDER as "anthropic" | "openai" | "fireworks") ??
      "fireworks",
    model:
      process.env.SAQ_LLM_MODEL ??
      "accounts/fireworks/models/deepseek-v4-flash",
  },
  browser: {
    headed: false,
    sessionName: "saq",
    defaultTimeout: 25_000,
  },
  systemPromptPath: "prompt/SYSTEM.md",
  skills: {
    dirs: ["skills", ".agents/skills"],
    preloads: ["core"],
    activate: [],
  },
  agent: {
    maxTurns: 500,
    bashTimeoutMs: 120_000,
  },
  auth: {},
};

export default config;

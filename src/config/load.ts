import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SaqConfig } from "../types/config.js";
import { loadEnv } from "./env.js";

const DEFAULT_CONFIG: SaqConfig = {
  baseUrl: process.env.SAQ_BASE_URL ?? "http://localhost:3000",
  systemPromptPath: "prompt/SYSTEM.md",
  llm: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v4-flash",
  },
  browser: {
    headed: false,
    sessionName: "saq",
    defaultTimeout: 25_000,
  },
  skills: {
    dirs: ["skills", ".agents/skills"],
    preloads: ["core"],
    activate: [],
  },
  agent: {
    maxTurns: 30,
    bashTimeoutMs: 120_000,
  },
  auth: {},
};

export async function loadConfig(
  configPath?: string,
  cwd = process.cwd(),
): Promise<SaqConfig> {
  loadEnv(cwd);

  const resolved = configPath
    ? path.resolve(cwd, configPath)
    : path.resolve(cwd, "saq.config.ts");

  try {
    const mod = await import(pathToFileURL(resolved).href);
    const config = (mod.default ?? mod) as Partial<SaqConfig>;
    return mergeConfig(DEFAULT_CONFIG, config);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function mergeConfig(base: SaqConfig, override: Partial<SaqConfig>): SaqConfig {
  return {
    ...base,
    ...override,
    llm: { ...base.llm, ...override.llm },
    browser: { ...base.browser, ...override.browser },
    skills: { ...base.skills, ...override.skills },
    agent: { ...base.agent, ...override.agent },
    auth: { ...base.auth, ...override.auth },
  };
}

const LLM_API_KEY_ENV: Record<SaqConfig["llm"]["provider"], string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
};

export function missingLlmApiKey(config: SaqConfig): string | undefined {
  const envVar = LLM_API_KEY_ENV[config.llm.provider];
  if (process.env[envVar]) return undefined;
  return `Missing ${envVar} for llm.provider "${config.llm.provider}"`;
}

export function resolveAuthState(
  config: SaqConfig,
  authName: string | undefined,
  cwd: string,
): string | undefined {
  if (!authName) return undefined;
  const entry = config.auth[authName];
  if (!entry?.statePath) {
    throw new Error(
      `Auth profile "${authName}" not configured in saq.config.ts`,
    );
  }
  return path.resolve(cwd, entry.statePath);
}

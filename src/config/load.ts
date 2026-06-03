import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CacheConfig, HealingConfig, PqaConfig, ReportConfig } from "../types/config.js";
import { loadEnv } from "./env.js";
import { resolveStatePath } from "../auth/store.js";
import { getPackageRoot, resolveBundledPath } from "../paths.js";

const LOCAL_CONFIG_CANDIDATES = [
  "pqa.config.json",
  "pqa.config.mjs",
  "pqa.config.js",
  "pqa.config.ts",
] as const;

const BUNDLED_CONFIG_CANDIDATES = [
  "pqa.config.ts",
  "pqa.config.mjs",
  "pqa.config.js",
  "pqa.config.json",
] as const;

/** Fallback when the bundled config file is missing (broken install). */
const MINIMAL_FALLBACK_CONFIG: PqaConfig = {
  systemPromptPath: "prompt/SYSTEM.md",
  envVars: [],
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
  },
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
  },
  skills: {
    dirs: ["skills", ".agents/skills"],
    preloads: ["core"],
  },
  agent: {
    maxTurns: 200,
    bashTimeoutMs: 120_000,
  },
  auth: {},
};

export const DEFAULT_TRANSIENT_PATTERNS = [
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
] as const;

let cachedBundledDefault: PqaConfig | undefined;

async function importConfigModule(resolved: string): Promise<Partial<PqaConfig>> {
  if (resolved.endsWith(".json")) {
    return JSON.parse(readFileSync(resolved, "utf-8")) as Partial<PqaConfig>;
  }
  if (resolved.endsWith(".ts")) {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const mod = jiti(resolved) as Partial<PqaConfig> & {
      default?: Partial<PqaConfig>;
    };
    return mod.default ?? mod;
  }
  const mod = await import(pathToFileURL(resolved).href);
  return (mod.default ?? mod) as Partial<PqaConfig>;
}

function normalizeBundledPaths(config: PqaConfig, cwd: string): PqaConfig {
  const promptPath = config.systemPromptPath ?? "prompt/SYSTEM.md";
  return {
    ...config,
    systemPromptPath: path.isAbsolute(promptPath)
      ? promptPath
      : resolveBundledPath(cwd, promptPath),
    skills: {
      ...config.skills,
      dirs: config.skills.dirs.map((dir) =>
        path.isAbsolute(dir) ? dir : resolveBundledPath(cwd, dir),
      ),
    },
  };
}

export async function loadReferenceConfig(): Promise<PqaConfig> {
  return loadBundledDefaultConfig();
}

async function loadBundledDefaultConfig(): Promise<PqaConfig> {
  if (cachedBundledDefault) return cachedBundledDefault;

  const pkgRoot = getPackageRoot();
  for (const candidate of BUNDLED_CONFIG_CANDIDATES) {
    const resolved = path.resolve(pkgRoot, candidate);
    if (!existsSync(resolved)) continue;
    try {
      const config = await importConfigModule(resolved);
      cachedBundledDefault = mergeConfig(MINIMAL_FALLBACK_CONFIG, config);
      return cachedBundledDefault;
    } catch {
      continue;
    }
  }

  cachedBundledDefault = MINIMAL_FALLBACK_CONFIG;
  return cachedBundledDefault;
}

export async function loadConfig(
  configPath?: string,
  cwd = process.cwd(),
): Promise<PqaConfig> {
  loadEnv(cwd);
  const bundledDefault = await loadBundledDefaultConfig();

  if (configPath) {
    const resolved = path.resolve(cwd, configPath);
    if (!existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    const config = await importConfigModule(resolved);
    return normalizeBundledPaths(mergeConfig(bundledDefault, config), cwd);
  }

  for (const candidate of LOCAL_CONFIG_CANDIDATES) {
    const resolved = path.resolve(cwd, candidate);
    if (!existsSync(resolved)) continue;
    try {
      const config = await importConfigModule(resolved);
      return normalizeBundledPaths(mergeConfig(bundledDefault, config), cwd);
    } catch {
      continue;
    }
  }

  return normalizeBundledPaths(bundledDefault, cwd);
}

function mergeConfig(base: PqaConfig, override: Partial<PqaConfig>): PqaConfig {
  return {
    ...base,
    ...override,
    envVars: override.envVars ?? base.envVars,
    sensitiveEnvVars: override.sensitiveEnvVars ?? base.sensitiveEnvVars,
    llm: { ...base.llm, ...override.llm },
    browser: { ...base.browser, ...override.browser },
    skills: { ...base.skills, ...override.skills },
    agent: { ...base.agent, ...override.agent },
    auth: { ...base.auth, ...override.auth },
    healing: {
      ...base.healing,
      ...override.healing,
      transientPatterns:
        override.healing?.transientPatterns ?? base.healing?.transientPatterns,
    },
    recorder: override.recorder
      ? { ...base.recorder, ...override.recorder }
      : base.recorder,
    cache: override.cache ? { ...base.cache, ...override.cache } : base.cache,
    report: override.report
      ? { ...base.report, ...override.report }
      : base.report,
  };
}

export function resolveCacheConfig(config: PqaConfig): Required<CacheConfig> {
  const cache = config.cache ?? {};
  return {
    dir: cache.dir ?? ".pqa/cache",
    enabled: cache.enabled ?? true,
  };
}

export function resolveReportConfig(
  config: PqaConfig,
  options?: { reportOutputPath?: string; reportZip?: boolean },
): Required<Pick<ReportConfig, "zip">> & Pick<ReportConfig, "outputPath"> {
  const report = config.report ?? {};
  const outputPath = options?.reportOutputPath ?? report.outputPath;
  return {
    outputPath: outputPath?.trim() ? outputPath : undefined,
    zip: options?.reportZip ?? report.zip ?? false,
  };
}

export function resolveHealingConfig(config: PqaConfig): Required<
  Pick<HealingConfig, "enabled" | "maxRecoveryTurns" | "recoverOnUnknown"> & {
    transientPatterns: string[];
  }
> {
  const healing = config.healing ?? {};
  return {
    enabled: healing.enabled ?? true,
    maxRecoveryTurns: healing.maxRecoveryTurns ?? 2,
    recoverOnUnknown: healing.recoverOnUnknown ?? false,
    transientPatterns:
      healing.transientPatterns ?? [...DEFAULT_TRANSIENT_PATTERNS],
  };
}

export const LLM_API_KEY_ENV: Partial<
  Record<PqaConfig["llm"]["provider"], string>
> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function resolveSensitiveEnvVars(config: PqaConfig): string[] {
  const base = config.sensitiveEnvVars ?? config.envVars ?? [];
  const llmKey = LLM_API_KEY_ENV[config.llm.provider];
  return llmKey
    ? [...new Set([...base, llmKey])].sort()
    : [...new Set(base)].sort();
}

export function missingLlmApiKey(config: PqaConfig): string | undefined {
  const envVar = LLM_API_KEY_ENV[config.llm.provider];
  if (!envVar) return undefined;
  if (process.env[envVar]) return undefined;
  return `Missing ${envVar} for llm.provider "${config.llm.provider}"`;
}

export function missingDeclaredEnvVars(config: PqaConfig): string | undefined {
  const missing = (config.envVars ?? []).filter((name) => !process.env[name]);
  if (missing.length === 0) return undefined;
  return `Missing environment variable(s) declared in config envVars: ${missing.join(", ")}`;
}

export function resolveAuthState(
  config: PqaConfig,
  authName: string | undefined,
  cwd: string,
): string | undefined {
  if (!authName) return undefined;
  const entry = config.auth[authName];
  if (!entry) {
    throw new Error(
      `Auth profile "${authName}" not configured in pqa.config`,
    );
  }
  if (!entry.scenario && !entry.statePath) {
    throw new Error(
      `Auth profile "${authName}" must define scenario and/or statePath in pqa.config`,
    );
  }
  return resolveStatePath(cwd, authName, config);
}

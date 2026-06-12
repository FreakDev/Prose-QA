import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BrowserHealthConfig,
  CacheConfig,
  HealingConfig,
  PqaConfig,
  ReportConfig,
} from "../types/config.js";
import { loadEnv } from "./env.js";
import { getPackageRoot, resolveBundledPath } from "../paths.js";
import { resolveStatePath } from "../auth/store.js";
import { resolveConfigExtensionHooks } from "./hooks.js";

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
  envVars: [],
  llm: {},
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine: "chrome",
  },
  skills: {
    dirs: [],
    preloads: [],
  },
  auth: {},
  agent: {
    maxTurns: 200,
    bashTimeoutMs: 120_000,
  },
};

export const DEFAULT_TRANSIENT_PATTERNS = [
  "timeout",
  "timed out",
  "waiting for",
  "navigation",
  "net::",
  "detached",
  "stale",
  "interrupted",
  "networkidle",
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
  return {
    ...config,
    skills: {
      ...config.skills,
      dirs: (config.skills.dirs ?? []).map((dir) =>
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

async function resolveBaseConfig(
  configPath: string | undefined,
  cwd: string,
): Promise<PqaConfig> {
  const bundledDefault = await loadBundledDefaultConfig();

  if (configPath) {
    const resolved = path.resolve(cwd, configPath);
    if (!existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    const partial = await importConfigModule(resolved);
    return normalizeBundledPaths(
      applyLlmEnvOverrides(mergeConfig(bundledDefault, partial)),
      cwd,
    );
  }

  for (const candidate of LOCAL_CONFIG_CANDIDATES) {
    const resolved = path.resolve(cwd, candidate);
    if (!existsSync(resolved)) continue;
    try {
      const partial = await importConfigModule(resolved);
      return normalizeBundledPaths(
        applyLlmEnvOverrides(mergeConfig(bundledDefault, partial)),
        cwd,
      );
    } catch {
      continue;
    }
  }

  return normalizeBundledPaths(applyLlmEnvOverrides(bundledDefault), cwd);
}

export async function loadConfig(
  configPath?: string,
  cwd = process.cwd(),
): Promise<PqaConfig> {
  loadEnv(cwd);

  const config = await resolveBaseConfig(configPath, cwd);

  try {
    const resolvedHooks = await resolveConfigExtensionHooks(config, cwd);
    if (!resolvedHooks) return config;
    return {
      ...config,
      extensions: {
        ...config.extensions,
        hooks: resolvedHooks,
      },
    };
  } catch (err) {
    console.warn(
      `[config] Failed to resolve hook modules: ${err instanceof Error ? err.message : String(err)}. Hooks will be skipped.`,
    );
    return {
      ...config,
      extensions: {
        ...config.extensions,
        hooks: undefined,
      },
    };
  }
}

type LlmProvider = NonNullable<PqaConfig["llm"]["provider"]>;

function applyLlmEnvOverrides(config: PqaConfig): PqaConfig {
  const provider = process.env.PQA_LLM_PROVIDER as LlmProvider | undefined;
  const model = process.env.PQA_LLM_MODEL;
  return {
    ...config,
    llm: {
      ...config.llm,
      ...(provider && !config.llm.provider ? { provider } : {}),
      ...(model && !config.llm.model ? { model } : {}),
    },
  };
}

function mergeConfig(base: PqaConfig, override: Partial<PqaConfig>): PqaConfig {
  return {
    ...base,
    ...override,
    envVars: override.envVars ?? base.envVars,
    sensitiveEnvVars: override.sensitiveEnvVars ?? base.sensitiveEnvVars,
    llm: { ...base.llm, ...override.llm },
    browser: {
      ...base.browser,
      ...override.browser,
      lightpanda: override.browser?.lightpanda
        ? { ...base.browser.lightpanda, ...override.browser.lightpanda }
        : base.browser.lightpanda,
    },
    skills: {
      ...base.skills,
      ...override.skills,
      dirs: override.skills?.dirs ?? base.skills.dirs ?? [],
      preloads: override.skills?.preloads ?? base.skills.preloads ?? [],
      onDemand: override.skills?.onDemand
        ? { ...base.skills.onDemand, ...override.skills.onDemand }
        : base.skills.onDemand,
    },
    auth: { ...(base.auth ?? {}), ...(override.auth ?? {}) },
    agent: { ...base.agent, ...override.agent },
    browserHealth: override.browserHealth
      ? { ...base.browserHealth, ...override.browserHealth }
      : base.browserHealth,
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
    extensions: override.extensions ?? base.extensions,
  };
}

/** Lightpanda is headless-only; headed CLI/config flags are ignored. */
/** CLI --parallel wins when set; otherwise agent.parallel from config. */
export function resolveAgentParallel(
  config: PqaConfig,
  cliParallel?: number,
): number | undefined {
  if (cliParallel !== undefined) return cliParallel;
  const configured = config.agent.parallel;
  if (configured === undefined || configured === 0) return undefined;
  if (configured < 0) return Number.POSITIVE_INFINITY;
  return configured;
}

export function resolveBrowserHeaded(
  config: PqaConfig,
  headed?: boolean,
): boolean {
  if (config.browser.engine === "lightpanda") return false;
  return headed ?? config.browser.headed;
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

export function resolveBrowserHealthConfig(
  config: PqaConfig,
): Required<BrowserHealthConfig> {
  const browserHealth = config.browserHealth ?? {};
  return {
    circuitBreakerThreshold: browserHealth.circuitBreakerThreshold ?? 3,
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

export const PQA_LLM_API_KEY = "PQA_LLM_API_KEY";

const LLM_PROVIDERS_REQUIRING_API_KEY = new Set<
  NonNullable<PqaConfig["llm"]["provider"]>
>(["anthropic", "openai", "fireworks", "google", "openrouter"]);

export function resolveSensitiveEnvVars(config: PqaConfig): string[] {
  const base = config.sensitiveEnvVars ?? config.envVars ?? [];
  const llmKey =
    config.llm.provider &&
    LLM_PROVIDERS_REQUIRING_API_KEY.has(config.llm.provider)
      ? PQA_LLM_API_KEY
      : undefined;
  return llmKey
    ? [...new Set([...base, llmKey])].sort()
    : [...new Set(base)].sort();
}

export function missingLlmConfig(config: PqaConfig): string | undefined {
  if (!config.llm.provider) {
    return "Missing llm.provider (set in pqa.config or PQA_LLM_PROVIDER)";
  }
  if (!config.llm.model) {
    return "Missing llm.model (set in pqa.config or PQA_LLM_MODEL)";
  }
  return undefined;
}

export function missingLlmApiKey(config: PqaConfig): string | undefined {
  const provider = config.llm.provider;
  if (!provider || !LLM_PROVIDERS_REQUIRING_API_KEY.has(provider)) {
    return undefined;
  }
  if (process.env[PQA_LLM_API_KEY]) return undefined;
  return `Missing ${PQA_LLM_API_KEY} for llm.provider "${provider}"`;
}

/** First missing llm.provider / llm.model / API key error, if any. */
export function missingLlmRequirements(config: PqaConfig): string | undefined {
  return missingLlmConfig(config) ?? missingLlmApiKey(config);
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
  const entry = config.auth?.[authName];
  if (!entry) {
    throw new Error(`Auth profile "${authName}" not configured in pqa.config`);
  }
  if (!entry.scenario && !entry.statePath) {
    throw new Error(
      `Auth profile "${authName}" must define scenario and/or statePath in pqa.config`,
    );
  }
  return resolveStatePath(cwd, authName, config);
}

import { HookRunner, HookAbortError } from "../agent/hooks.js";
import type { EnsureAuthContext } from "../auth/resolve.js";
import type { PqaConfig } from "../types/config.js";
import type {
  BatchEntrypoint,
  BatchScenarioSummary,
  BatchStatus,
  ExtensionHooks,
  PostBatchParams,
  PreBatchParams,
} from "../types/hooks.js";
import type { ScenarioResult } from "../types/verdict.js";

export interface RunPreBatchPhaseOptions {
  config: PqaConfig;
  cwd: string;
  extensionHooks?: ExtensionHooks;
  runId: string;
  runDir: string;
  entrypoint: BatchEntrypoint;
  scenarios: BatchScenarioSummary[];
  requiredProfiles: string[];
  authRefresh?: boolean;
  ensureAuthContext?: EnsureAuthContext;
  verbose?: boolean;
}

export interface RunPostBatchPhaseOptions {
  config: PqaConfig;
  cwd: string;
  extensionHooks?: ExtensionHooks;
  runId: string;
  runDir: string;
  entrypoint: BatchEntrypoint;
  scenarios: BatchScenarioSummary[];
  requiredProfiles: string[];
  results: ScenarioResult[];
  status: BatchStatus;
  batchMetadata?: Record<string, unknown>;
  verbose?: boolean;
}

function createBatchHookContext(
  options: {
    config: PqaConfig;
    cwd: string;
    verbose?: boolean;
    metadata: Record<string, unknown>;
  },
): ConstructorParameters<typeof HookRunner>[1] {
  return {
    logger: {
      info: (msg: string) => {
        if (options.verbose) console.log(`[hook] ${msg}`);
      },
      warn: (msg: string) => console.warn(`[hook] ${msg}`),
      error: (msg: string) => console.error(`[hook] ${msg}`),
    },
    cwd: options.cwd,
    config: options.config,
    transcript: { entries: [] },
    metadata: options.metadata,
    abort: (reason: string): never => {
      throw new HookAbortError(reason);
    },
  };
}

export async function runPreBatchPhase(
  options: RunPreBatchPhaseOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const metadata: Record<string, unknown> = {
    authResolved: new Map<string, string>(),
    ...(options.authRefresh !== undefined
      ? { authRefresh: options.authRefresh }
      : {}),
    ...(options.ensureAuthContext
      ? { ensureAuthContext: options.ensureAuthContext }
      : {}),
  };

  const hookRunner = new HookRunner(
    options.extensionHooks ?? {},
    createBatchHookContext({
      config: options.config,
      cwd: options.cwd,
      verbose: options.verbose,
      metadata,
    }),
  );

  const params: PreBatchParams = {
    runId: options.runId,
    runDir: options.runDir,
    entrypoint: options.entrypoint,
    scenarios: options.scenarios,
    requiredProfiles: options.requiredProfiles,
    ...(options.authRefresh !== undefined
      ? { authRefresh: options.authRefresh }
      : {}),
  };

  try {
    const result = await hookRunner.runPreBatch(params);
    if (result.action === "abort") {
      return { ok: false, error: result.error };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof HookAbortError) {
      return { ok: false, error: err.reason };
    }
    throw err;
  }
}

export async function runPostBatchPhase(
  options: RunPostBatchPhaseOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hookRunner = new HookRunner(
    options.extensionHooks ?? {},
    createBatchHookContext({
      config: options.config,
      cwd: options.cwd,
      verbose: options.verbose,
      metadata: options.batchMetadata ?? {},
    }),
  );

  const params: PostBatchParams = {
    runId: options.runId,
    runDir: options.runDir,
    entrypoint: options.entrypoint,
    scenarios: options.scenarios,
    requiredProfiles: options.requiredProfiles,
    results: options.results,
    status: options.status,
  };

  try {
    const result = await hookRunner.runPostBatch(params);
    if (result.action === "abort") {
      return { ok: false, error: result.error };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof HookAbortError) {
      return { ok: false, error: err.reason };
    }
    throw err;
  }
}

export function aggregateBatchStatus(
  results: ScenarioResult[],
): BatchStatus {
  if (results.some((r) => r.status === "error")) return "error";
  if (results.some((r) => r.status === "fail")) return "fail";
  return "pass";
}

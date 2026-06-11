import type { EnsureAuthContext } from "../auth/resolve.js";
import { ensureAuthProfiles } from "../auth/resolve.js";
import type { PreBatchHook } from "../types/hooks.js";

function readEnsureAuthContext(
  metadata: Record<string, unknown>,
): EnsureAuthContext | undefined {
  const ctx = metadata.ensureAuthContext;
  if (!ctx || typeof ctx !== "object") return undefined;
  return ctx as EnsureAuthContext;
}

function readAuthResolved(
  metadata: Record<string, unknown>,
): Map<string, string> {
  const value = metadata.authResolved;
  if (value instanceof Map) return value;
  const map = new Map<string, string>();
  metadata.authResolved = map;
  return map;
}

export const ensureProfilesBatchHook: PreBatchHook = async (params, ctx) => {
  if (params.requiredProfiles.length === 0) {
    return { action: "continue" };
  }

  const ensureCtx = readEnsureAuthContext(ctx.metadata);
  if (!ensureCtx) {
    return {
      action: "abort",
      error:
        "preBatch auth hook requires ensureAuthContext in hook metadata (harness misconfiguration)",
    };
  }

  try {
    const resolved = await ensureAuthProfiles(
      {
        ...ensureCtx,
        authRefresh:
          ensureCtx.authRefresh ??
          params.authRefresh ??
          Boolean(ctx.metadata.authRefresh),
      },
      params.requiredProfiles,
    );
    const authResolved = readAuthResolved(ctx.metadata);
    for (const [profile, statePath] of resolved) {
      authResolved.set(profile, statePath);
    }
  } catch (err) {
    return {
      action: "abort",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { action: "continue" };
};

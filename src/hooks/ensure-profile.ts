import type { EnsureAuthContext } from "../auth/resolve.js";
import { ensureAuthProfile } from "../auth/resolve.js";
import {
  getAuthEntry,
  resolveBrowserContextForProfile,
} from "../auth/store.js";
import type { PreScenarioHook } from "../types/hooks.js";

function readEnsureAuthContext(
  metadata: Record<string, unknown>,
): EnsureAuthContext | undefined {
  const ctx = metadata.ensureAuthContext;
  if (!ctx || typeof ctx !== "object") return undefined;
  return ctx as EnsureAuthContext;
}

export const ensureProfileHook: PreScenarioHook = async (scenario, ctx) => {
  if (ctx.metadata.provisioning) {
    return { action: "continue" };
  }

  const profile = scenario.frontmatter.auth;
  if (!profile) {
    return { action: "continue" };
  }

  const authEntry = getAuthEntry(ctx.config, profile);
  if (!authEntry) {
    return {
      action: "abort",
      error: `Auth profile "${profile}" not configured in pqa.config`,
    };
  }

  const ensureCtx = readEnsureAuthContext(ctx.metadata);
  if (!ensureCtx) {
    return {
      action: "abort",
      error:
        "Profile hook requires ensureAuthContext in hook metadata (harness misconfiguration)",
    };
  }

  try {
    await ensureAuthProfile(
      {
        ...ensureCtx,
        authRefresh:
          ensureCtx.authRefresh ?? Boolean(ctx.metadata.authRefresh),
      },
      profile,
    );
  } catch (err) {
    return {
      action: "abort",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    action: "continue",
    browserContext: resolveBrowserContextForProfile(
      ctx.config,
      ctx.cwd,
      profile,
    ),
  };
};

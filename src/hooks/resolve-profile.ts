import {
  getAuthEntry,
  hasState,
  resolveBrowserContextForProfile,
} from "../auth/store.js";
import type { PreScenarioHook } from "../types/hooks.js";

function readAuthResolved(
  metadata: Record<string, unknown>,
): Map<string, string> | undefined {
  const value = metadata.authResolved;
  return value instanceof Map ? value : undefined;
}

export const resolveProfileHook: PreScenarioHook = async (scenario, ctx) => {
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

  const authResolved = readAuthResolved(ctx.metadata);
  const resolvedPath = authResolved?.get(profile);
  const stateReady =
    Boolean(resolvedPath) ||
    hasState(ctx.cwd, profile, ctx.config);

  if (!stateReady) {
    ctx.logger.warn(
      `Auth profile "${profile}" is required but no persisted state was found. ` +
        "Ensure defaultExtensionHooks.preBatch includes ensureProfilesBatchHook " +
        "or pre-seed auth state manually.",
    );
    return {
      action: "abort",
      error:
        `Auth profile "${profile}" is not provisioned. ` +
        "Run a consumer scenario with auth hooks configured or refresh with --auth-refresh.",
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

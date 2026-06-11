import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runScenario } from "../agent/runner.js";
import { buildBrowserEnv, closeBrowserSession, runBash } from "../agent/bash.js";
import { applyArtifactsPolicy } from "../artifacts/policy.js";
import type { ArtifactsMode, PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import { resolveSkills } from "../skills/loader.js";
import { scenarioArtifactDir } from "../reporter/index.js";
import type { EnvRedactor } from "../redact/env-secrets.js";
import {
  clear as clearAuthStore,
  getAuthEntry,
  hasState,
  record,
  resolveBrowserContextForProfile,
  resolveProfilePath,
  resolveStatePath,
} from "./store.js";

export interface EnsureAuthContext {
  config: PqaConfig;
  allSkills: Skill[];
  baseSkillNames: string[];
  cwd: string;
  runDir: string;
  headed: boolean;
  verbose?: boolean;
  allScenarios: Scenario[];
  authRefresh?: boolean;
  keepBrowser?: boolean;
  artifacts: ArtifactsMode;
  redactor: EnvRedactor;
}

function findScenarioByName(
  scenarios: Scenario[],
  name: string,
): Scenario | undefined {
  return scenarios.find((s) => s.frontmatter.name === name);
}

interface SavedBrowserState {
  cookies?: unknown[];
}

function assertNonEmptyAuthState(statePath: string, profile: string): void {
  let parsed: SavedBrowserState;
  try {
    parsed = JSON.parse(readFileSync(statePath, "utf-8")) as SavedBrowserState;
  } catch {
    throw new Error(
      `Auth state for profile "${profile}" is not valid JSON at ${statePath}`,
    );
  }

  const cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
  if (cookieCount === 0) {
    throw new Error(
      `Auth state for profile "${profile}" has no cookies at ${statePath}. ` +
        "The auth browser session was likely closed before the harness could save state. " +
        "Re-run auth without agent-browser close/state save commands.",
    );
  }
}

async function saveBrowserState(
  ctx: EnsureAuthContext,
  profile: string,
  statePath: string,
): Promise<void> {
  mkdirSync(path.dirname(statePath), { recursive: true });
  mkdirSync(resolveProfilePath(ctx.cwd, profile), { recursive: true });
  const browserContext = resolveBrowserContextForProfile(
    ctx.config,
    ctx.cwd,
    profile,
  );
  const bashEnv = buildBrowserEnv({
    cwd: ctx.cwd,
    headed: ctx.headed,
    sessionName: `pqa-auth-${profile}`,
    engine: ctx.config.browser.engine,
    lightpanda: ctx.config.browser.lightpanda,
    profilePath: browserContext.profilePath,
    authStatePath: browserContext.profilePath
      ? undefined
      : browserContext.authStatePath,
    artifactDir: ctx.cwd,
  });

  const urlEntry = await runBash("agent-browser get url", {
    cwd: ctx.cwd,
    timeoutMs: ctx.config.agent.bashTimeoutMs,
    env: bashEnv,
  });
  const currentUrl = urlEntry.stdout.trim();
  if (
    urlEntry.exitCode !== 0 ||
    !currentUrl ||
    currentUrl === "about:blank"
  ) {
    throw new Error(
      `Cannot save auth state for profile "${profile}": browser session is not on a signed-in page ` +
        `(url=${currentUrl || "(empty)"}). Do not run agent-browser close before the harness saves state.`,
    );
  }

  const saveEntry = await runBash(
    `agent-browser state save "${statePath}"`,
    {
      cwd: ctx.cwd,
      timeoutMs: ctx.config.agent.bashTimeoutMs,
      env: bashEnv,
    },
  );

  if (saveEntry.exitCode !== 0) {
    throw new Error(
      `Failed to save auth state for profile "${profile}": ${saveEntry.stderr || saveEntry.stdout}`,
    );
  }

  assertNonEmptyAuthState(statePath, profile);
}

export async function ensureAuthProfile(
  ctx: EnsureAuthContext,
  profile: string,
): Promise<string> {
  const authEntry = getAuthEntry(ctx.config, profile);
  if (!authEntry) {
    throw new Error(`Auth profile "${profile}" not configured in pqa.config.ts`);
  }

  const statePath = resolveStatePath(ctx.cwd, profile, ctx.config);

  if (!authEntry.scenario) {
    if (!authEntry.statePath && !hasState(ctx.cwd, profile, ctx.config)) {
      throw new Error(
        `Auth profile "${profile}" has no scenario and no state file at ${statePath}`,
      );
    }
    return statePath;
  }

  if (ctx.authRefresh) {
    clearAuthStore(ctx.cwd, profile);
  }

  if (hasState(ctx.cwd, profile, ctx.config)) {
    return statePath;
  }

  const authScenario = findScenarioByName(
    ctx.allScenarios,
    authEntry.scenario,
  );
  if (!authScenario) {
    throw new Error(
      `Auth scenario "${authEntry.scenario}" not found for profile "${profile}"`,
    );
  }

  const artifactDir = scenarioArtifactDir(ctx.runDir, `auth-${profile}`);
  const sessionName = `pqa-auth-${profile}`;
  const browserContext = resolveBrowserContextForProfile(
    ctx.config,
    ctx.cwd,
    profile,
  );
  if (browserContext.profilePath) {
    mkdirSync(browserContext.profilePath, { recursive: true });
  }

  try {
    const skills = resolveSkills(
      ctx.allSkills,
      ctx.baseSkillNames,
      authScenario.skills,
    );
    const result = await runScenario({
      config: ctx.config,
      skills,
      scenario: authScenario,
      cwd: ctx.cwd,
      artifactDir,
      runDir: ctx.runDir,
      headed: ctx.headed,
      verbose: ctx.verbose,
      artifacts: ctx.artifacts,
      sessionName,
      authProfile: profile,
      profilePath: browserContext.profilePath,
      authStatePath: browserContext.profilePath
        ? undefined
        : browserContext.authStatePath,
      redactor: ctx.redactor,
      provisioning: true,
      extensionHooks: ctx.config.extensions?.hooks,
    });

    applyArtifactsPolicy(artifactDir, ctx.artifacts, result);

    if (result.status !== "pass") {
      throw new Error(
        `Auth scenario "${authEntry.scenario}" failed for profile "${profile}"${result.error ? `: ${result.error}` : ""}`,
      );
    }

    await saveBrowserState(ctx, profile, statePath);
    record(ctx.cwd, profile, {
      statePath,
      scenario: authEntry.scenario,
    });
  } finally {
    if (!ctx.keepBrowser) {
      await closeBrowserSession({
        cwd: ctx.cwd,
        timeoutMs: ctx.config.agent.bashTimeoutMs,
        sessionName,
        headed: ctx.headed,
        engine: ctx.config.browser.engine,
        lightpanda: ctx.config.browser.lightpanda,
        verbose: ctx.verbose,
      });
    }
  }

  return statePath;
}

export async function ensureAuthProfiles(
  ctx: EnsureAuthContext,
  profiles: Iterable<string>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const unique = [...new Set(profiles)];

  for (const profile of unique) {
    resolved.set(profile, await ensureAuthProfile(ctx, profile));
  }

  return resolved;
}

export function resolveConsumerAuthState(
  config: PqaConfig,
  authName: string | undefined,
  cwd: string,
  preResolved?: Map<string, string>,
): string | undefined {
  if (!authName) return undefined;

  if (preResolved?.has(authName)) {
    return preResolved.get(authName);
  }

  const entry = config.auth?.[authName];
  if (!entry) {
    throw new Error(`Auth profile "${authName}" not configured in pqa.config.ts`);
  }

  return resolveStatePath(cwd, authName, config);
}

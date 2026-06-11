import type { EnsureAuthContext } from "../auth/resolve.js";
import type { ArtifactsMode, PqaConfig } from "../types/config.js";
import type { BatchScenarioSummary } from "../types/hooks.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import { getAuthEntry } from "../auth/store.js";
import type { EnvRedactor } from "../redact/env-secrets.js";

export function collectRequiredProfiles(
  summaries: Array<{ frontmatter: { auth?: string } }>,
): string[] {
  return [
    ...new Set(
      summaries
        .map((s) => s.frontmatter.auth)
        .filter((profile): profile is string => Boolean(profile)),
    ),
  ];
}

export function toBatchScenarioSummaries(
  summaries: Array<{ frontmatter: { name: string; auth?: string } }>,
): BatchScenarioSummary[] {
  return summaries.map((s) => ({
    name: s.frontmatter.name,
    ...(s.frontmatter.auth ? { auth: s.frontmatter.auth } : {}),
  }));
}

export function toBatchScenarioSummary(scenario: Scenario): BatchScenarioSummary {
  return {
    name: scenario.frontmatter.name,
    ...(scenario.frontmatter.auth
      ? { auth: scenario.frontmatter.auth }
      : {}),
  };
}

export function authScenarioNamesForProfiles(
  config: PqaConfig,
  profiles: string[],
): string[] {
  return [
    ...new Set(
      profiles
        .map((profile) => getAuthEntry(config, profile)?.scenario)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

export function buildEnsureAuthContext(options: {
  config: PqaConfig;
  allSkills: Skill[];
  baseSkillNames: string[];
  cwd: string;
  runDir: string;
  headed: boolean;
  verbose?: boolean;
  allScenarios: Scenario[];
  authRefresh?: boolean;
  keepBrowser: boolean;
  artifacts: ArtifactsMode;
  redactor: EnvRedactor;
}): EnsureAuthContext {
  return {
    config: options.config,
    allSkills: options.allSkills,
    baseSkillNames: options.baseSkillNames,
    cwd: options.cwd,
    runDir: options.runDir,
    headed: options.headed,
    verbose: options.verbose,
    allScenarios: options.allScenarios,
    authRefresh: options.authRefresh,
    keepBrowser: options.keepBrowser,
    artifacts: options.artifacts,
    redactor: options.redactor,
  };
}

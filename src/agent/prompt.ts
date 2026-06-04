import type { PqaConfig, ArtifactsMode } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import { formatArtifactsRuntimeHint } from "../artifacts/policy.js";
import { resolveStatePath } from "../auth/store.js";
import { formatDeclaredEnvVarHints } from "../config/env-vars.js";
import { loadSystemPrompt } from "../prompt/load.js";
import { buildSkillPrompt } from "../skills/loader.js";
import { formatScenarioForPrompt } from "../scenarios/parser.js";

const EXECUTION_HINT =
  "Use the Observe-Act-Verify loop from the system prompt. After all Steps, verify every Then checkpoint with CLI evidence before emitting the verdict JSON.";

export function buildInitialPrompt(
  scenario: Scenario,
  preparedStartUrl?: string,
): string {
  const name = scenario.frontmatter.name;
  if (preparedStartUrl && preparedStartUrl !== "about:blank") {
    const authClause = scenario.frontmatter.auth
      ? "with auth state loaded. "
      : "The harness opened this page via agent-browser. ";
    return (
      `Execute the scenario "${name}" now. The browser is already open on ${preparedStartUrl} ` +
      `${authClause}Continue from Step 1 without running agent-browser close. ` +
      EXECUTION_HINT
    );
  }
  if (preparedStartUrl === "about:blank") {
    return (
      `Execute the scenario "${name}" now. Auth state is loaded in the browser session. ` +
      `Follow the Steps without running agent-browser close first. ${EXECUTION_HINT}`
    );
  }
  const url = scenario.frontmatter.url;
  if (url) {
    return `Execute the scenario "${name}" now. Start by opening ${url} with agent-browser, then continue with the Steps. ${EXECUTION_HINT}`;
  }
  return `Execute the scenario "${name}" now. Follow the Steps, navigating to any URLs specified there with agent-browser. ${EXECUTION_HINT}`;
}

export function buildSystemPrompt(
  config: PqaConfig,
  skills: Skill[],
  scenario: Scenario,
  runtime: {
    cwd: string;
    artifactDir: string;
    authStatePath?: string;
    authProfile?: string;
    profilePath?: string;
    headed: boolean;
    sessionName: string;
    artifacts: ArtifactsMode;
    scenarioCacheHints?: string;
    preparedStartUrl?: string;
  },
): string {
  const systemPrompt = loadSystemPrompt(runtime.cwd);
  const skillBlock = buildSkillPrompt(skills);
  const scenarioBlock = formatScenarioForPrompt(scenario);

  const authSavePath = runtime.authProfile
    ? resolveStatePath(runtime.cwd, runtime.authProfile, config)
    : undefined;

  const envHints = [
    runtime.authProfile
      ? [
          `Auth scenario for profile "${runtime.authProfile}" — complete login Steps and Then checkpoints.`,
          "The harness saves browser state and closes the session after you pass.",
          "Do NOT run: agent-browser close, agent-browser close --all, or agent-browser state save.",
          "Leave the browser on the signed-in page until your final verdict.",
        ].join("\n")
      : null,
    scenario.frontmatter.url
      ? runtime.preparedStartUrl && runtime.preparedStartUrl !== "about:blank"
        ? `Scenario start URL: ${scenario.frontmatter.url} (harness already opened it — do not reload or agent-browser open this URL again)`
        : `Scenario start URL: ${scenario.frontmatter.url} (open this before executing Steps)`
      : "No start URL — navigate to URLs as specified in Steps",
    `Artifact directory: ${runtime.artifactDir}`,
    formatArtifactsRuntimeHint(runtime.artifacts),
    `Browser session: ${runtime.sessionName}`,
    `Headed mode: ${runtime.headed}`,
    runtime.profilePath
      ? `Auth browser profile: ${runtime.profilePath} (already signed in — do not run agent-browser close or reopen with --state)`
      : runtime.authStatePath
        ? `Auth state file: ${runtime.authStatePath}`
        : "No auth state preloaded",
    authSavePath ? `Auth state will be saved to: ${authSavePath}` : null,
    `Then checkpoints to verify: ${scenario.then.length}`,
    "",
    "Harness environment variables available in bash:",
    "- PQA_ARTIFACT_DIR",
    "- AGENT_BROWSER_SESSION_NAME",
    runtime.profilePath ? "- AGENT_BROWSER_PROFILE" : null,
    runtime.authStatePath && !runtime.profilePath
      ? "- AGENT_BROWSER_STATE"
      : null,
    authSavePath ? "- PQA_AUTH_SAVE_PATH" : null,
    ...formatDeclaredEnvVarHints(config.envVars ?? []),
  ]
    .filter(Boolean)
    .join("\n");

  const cacheBlock = runtime.scenarioCacheHints?.trim()
    ? `## Scenario replay hints (prior successful runs)

${runtime.scenarioCacheHints.trim()}

Treat these as accelerators, not strict scripts. Re-snapshot and adapt if the UI changed.

---

`
    : "";

  return `${systemPrompt}

Runtime:
${envHints}

---

${skillBlock}

---

${cacheBlock}${scenarioBlock}`;
}

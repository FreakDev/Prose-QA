import type { SaqConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import { loadSystemPrompt } from "../prompt/load.js";
import { buildSkillPrompt } from "../skills/loader.js";
import { formatScenarioForPrompt } from "../scenarios/parser.js";

export function buildSystemPrompt(
  config: SaqConfig,
  skills: Skill[],
  scenario: Scenario,
  runtime: {
    cwd: string;
    baseUrl: string;
    artifactDir: string;
    authStatePath?: string;
    headed: boolean;
    sessionName: string;
  },
): string {
  const systemPrompt = loadSystemPrompt(
    runtime.cwd,
    config.systemPromptPath,
  );
  const skillBlock = buildSkillPrompt(skills);
  const scenarioBlock = formatScenarioForPrompt(scenario);

  const envHints = [
    `Base URL: ${runtime.baseUrl}`,
    `Artifact directory: ${runtime.artifactDir}`,
    `Browser session: ${runtime.sessionName}`,
    `Headed mode: ${runtime.headed}`,
    runtime.authStatePath
      ? `Auth state file: ${runtime.authStatePath} (use agent-browser --state "$AGENT_BROWSER_STATE" when opening)`
      : "No auth state preloaded",
    "",
    "Environment variables available in bash:",
    "- SAQ_BASE_URL",
    "- SAQ_ARTIFACT_DIR",
    "- AGENT_BROWSER_SESSION_NAME",
    runtime.authStatePath ? "- AGENT_BROWSER_STATE" : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${systemPrompt}

Runtime:
${envHints}

---

${skillBlock}

---

${scenarioBlock}`;
}

export function buildAuthPrompt(
  _config: SaqConfig,
  skills: Skill[],
  authName: string,
  loginUrl: string,
  statePath: string,
): string {
  const skillBlock = buildSkillPrompt(skills);
  return `You are helping save authentication state for SAQ regression tests.

Log into the application at ${loginUrl} using agent-browser bash commands.
When login is complete and the authenticated session is verified, run:
  agent-browser state save ${statePath}

Auth profile name: ${authName}

${skillBlock}`;
}

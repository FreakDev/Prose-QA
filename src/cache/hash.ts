import { createHash } from "node:crypto";
import type { Scenario } from "../types/scenario.js";

/** Canonical payload used for cache invalidation (post-expansion content). */
export function scenarioContentPayload(scenario: Scenario): Record<string, unknown> {
  const { name, url, auth, tags, skills } = scenario.frontmatter;
  return {
    name,
    url: url ?? null,
    auth: auth ?? null,
    tags: tags ?? [],
    skills: skills ?? scenario.skills,
    goal: scenario.goal.trim(),
    steps: scenario.steps.trim(),
    then: scenario.then.map((t) => t.trim()),
  };
}

export function hashScenarioContent(scenario: Scenario): string {
  const payload = scenarioContentPayload(scenario);
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import { buildInitialPrompt, buildSystemPrompt } from "./prompt.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const baseConfig: PqaConfig = {
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
  systemPromptPath: path.join(repoRoot, "prompt/SYSTEM.md"),
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 100, bashTimeoutMs: 120_000 },
  auth: {},
};

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    filePath: "/tmp/example.md",
    frontmatter: { name: "example-smoke" },
    skills: [],
    goal: "Verify the dashboard loads.",
    steps: "1. Open the app.",
    then: ['url contains "/dashboard"', 'page shows "Welcome"'],
    rawCheckpoints: [
      'url contains "/dashboard"',
      'page shows "Welcome"',
    ],
    checkpoints: [
      { raw: 'url contains "/dashboard"', kind: "url_contains", value: "/dashboard" },
      { raw: 'page shows "Welcome"', kind: "page_shows", value: "Welcome" },
    ],
    ...overrides,
  };
}

describe("buildInitialPrompt", () => {
  it("includes Observe-Act-Verify execution hint in all variants", () => {
    const scenario = makeScenario();
    const hint = "Observe-Act-Verify loop";

    assert.match(buildInitialPrompt(scenario), new RegExp(hint));
    assert.match(
      buildInitialPrompt(scenario, "http://localhost:3000/clients"),
      new RegExp(hint),
    );
    assert.match(buildInitialPrompt(scenario, "about:blank"), new RegExp(hint));
    assert.match(
      buildInitialPrompt(
        makeScenario({
          frontmatter: { name: "with-url", url: "http://localhost:3000" },
        }),
      ),
      new RegExp(hint),
    );
  });

  it("asks agent to open start URL when frontmatter url is set but harness did not preload", () => {
    const prompt = buildInitialPrompt(
      makeScenario({
        frontmatter: { name: "with-url", url: "http://localhost:3000/clients" },
      }),
    );
    assert.match(prompt, /http:\/\/localhost:3000\/clients/);
    assert.match(prompt, /agent-browser/);
    assert.doesNotMatch(prompt, /already open/i);
  });

  it("tells agent not to reload when harness pre-opened frontmatter url", () => {
    const prompt = buildInitialPrompt(
      makeScenario({
        frontmatter: { name: "hello", url: "http://127.0.0.1:8080/" },
      }),
      "http://127.0.0.1:8080/",
    );
    assert.match(prompt, /already open on http:\/\/127\.0\.0\.1:8080\//);
    assert.match(prompt, /harness opened this page via agent-browser/i);
    assert.match(prompt, /Continue from Step 1 without running agent-browser close/i);
    assert.doesNotMatch(prompt, /auth state loaded/i);
  });

  it("mentions auth when harness pre-opened url with auth profile", () => {
    const prompt = buildInitialPrompt(
      makeScenario({
        frontmatter: {
          name: "authed",
          url: "http://127.0.0.1:8080/projects",
          auth: "admin",
        },
      }),
      "http://127.0.0.1:8080/projects",
    );
    assert.match(prompt, /auth state loaded/i);
    assert.match(prompt, /Continue from Step 1 without running agent-browser close/i);
    assert.doesNotMatch(prompt, /harness opened this page via agent-browser/i);
  });
});

describe("buildSystemPrompt", () => {
  it("includes scenario block and Then checkpoint count in runtime hints", () => {
    const scenario = makeScenario();
    const skills: Skill[] = [];
    const prompt = buildSystemPrompt(baseConfig, skills, scenario, {
      cwd: repoRoot,
      artifactDir: "/tmp/pqa-artifacts",
      headed: false,
      sessionName: "pqa",
      artifacts: "on-failure",
    });

    assert.match(prompt, /# Scenario: example-smoke/);
    assert.match(prompt, /Then checkpoints to verify: 2/);
    assert.match(prompt, /Observe-Act-Verify loop/);
    assert.match(prompt, /url contains "\/dashboard"/);
  });

  it("marks frontmatter url as harness-opened when preparedStartUrl is set", () => {
    const scenario = makeScenario({
      frontmatter: { name: "preloaded", url: "http://127.0.0.1:8080/" },
    });
    const prompt = buildSystemPrompt(baseConfig, [], scenario, {
      cwd: repoRoot,
      artifactDir: "/tmp/pqa-artifacts",
      headed: false,
      sessionName: "pqa",
      artifacts: "on-failure",
      preparedStartUrl: "http://127.0.0.1:8080/",
    });

    assert.match(prompt, /harness already opened it/);
    assert.doesNotMatch(prompt, /open this before executing Steps/);
  });

  it("includes scenario replay hints block when provided", () => {
    const scenario = makeScenario();
    const prompt = buildSystemPrompt(baseConfig, [], scenario, {
      cwd: repoRoot,
      artifactDir: "/tmp/pqa-artifacts",
      headed: false,
      sessionName: "pqa",
      artifacts: "on-failure",
      scenarioCacheHints: "### Effective actions\n- Use snapshot -i first",
    });

    assert.match(prompt, /Scenario replay hints \(prior successful runs\)/);
    assert.match(prompt, /Use snapshot -i first/);
    assert.match(prompt, /Re-snapshot and adapt if the UI changed/);
    const scenarioIndex = prompt.indexOf("# Scenario: example-smoke");
    const hintsIndex = prompt.indexOf("Scenario replay hints");
    assert.ok(hintsIndex > 0 && hintsIndex < scenarioIndex);
  });
});

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import {
  SkillLoadRegistry,
  formatOnDemandCatalog,
  inferAutoSkillLoads,
  readSkillManifest,
} from "./on-demand.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    filePath: "/tmp/example.md",
    frontmatter: { name: "example" },
    skills: ["core"],
    goal: "Goal",
    steps: "1. Step",
    then: ['page shows "ok"'],
    rawCheckpoints: ['page shows "ok"'],
    checkpoints: [{ raw: 'page shows "ok"', kind: "page_shows", value: "ok" }],
    ...overrides,
  };
}

describe("readSkillManifest", () => {
  it("reads manifest after sync-skills", () => {
    const manifest = readSkillManifest(repoRoot);
    assert.ok(manifest);
    assert.ok(manifest!.core.references.includes("authentication"));
    assert.ok(manifest!.bundled.length > 0);
  });
});

describe("SkillLoadRegistry", () => {
  it("loads a reference and deduplicates subsequent loads", () => {
    const registry = new SkillLoadRegistry();
    const first = registry.load(repoRoot, "reference", "authentication");
    assert.equal(first.alreadyLoaded, false);
    assert.match(first.content, /auth/i);

    const second = registry.load(repoRoot, "reference", "authentication");
    assert.equal(second.alreadyLoaded, true);
  });

  it("throws for unknown reference via error message in load path", () => {
    const registry = new SkillLoadRegistry();
    assert.throws(
      () => registry.load(repoRoot, "reference", "does-not-exist-xyz"),
      /not found/i,
    );
  });

  it("loads a custom skill from skills.dirs", () => {
    const registry = new SkillLoadRegistry({
      skillDirs: ["skills"],
      preloadedNames: ["core"],
    });
    const result = registry.load(repoRoot, "custom", "prose-qa");
    assert.equal(result.alreadyLoaded, false);
    assert.match(result.content, /Prose-QA scenario authoring/i);
  });

  it("falls back to custom skill when bundled skill is missing", () => {
    const registry = new SkillLoadRegistry({
      skillDirs: ["skills"],
      preloadedNames: ["core"],
    });
    const result = registry.load(repoRoot, "skill", "prose-qa");
    assert.equal(result.alreadyLoaded, false);
    assert.match(result.content, /scenario authoring/i);
  });

  it("returns alreadyLoaded for skills preloaded in the system prompt", () => {
    const registry = new SkillLoadRegistry({
      skillDirs: ["skills"],
      preloadedNames: ["core", "prose-qa"],
    });
    const result = registry.load(repoRoot, "custom", "prose-qa");
    assert.equal(result.alreadyLoaded, true);
    assert.match(result.content, /already preloaded/i);
  });
});

describe("inferAutoSkillLoads", () => {
  it("returns no auto-loaded references by default", () => {
    const loads = inferAutoSkillLoads({
      scenario: makeScenario({
        frontmatter: { name: "login-admin", tags: ["auth"] },
      }),
    });
    assert.deepEqual(loads, []);
  });
});

describe("formatOnDemandCatalog", () => {
  it("lists references and bundled skills for core", () => {
    const skills: Skill[] = [
      {
        name: "core",
        description: "core skill",
        dir: path.join(repoRoot, "skills/agent-browser"),
        frontmatter: { name: "core", description: "core skill" },
        body: "minimal core body",
      },
    ];
    const catalog = formatOnDemandCatalog(repoRoot, skills, {
      skillDirs: ["skills"],
    });
    assert.match(catalog, /load_skill/);
    assert.match(catalog, /authentication/);
    assert.match(catalog, /Custom project skills/);
    assert.match(catalog, /prose-qa/);
    assert.match(catalog, /do \*\*not\*\* run `agent-browser skills get`/);
  });
});

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CORE_SKILL_NAME,
  discoverSkills,
  loadBundledCoreSkill,
  resolveBaseSkillNames,
} from "./loader.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("loadBundledCoreSkill", () => {
  it("loads the vendored agent-browser core skill", () => {
    const core = loadBundledCoreSkill(repoRoot);
    assert.equal(core.name, CORE_SKILL_NAME);
    assert.ok(core.body.length > 0);
    assert.match(core.dir, /skills[/\\]agent-browser$/);
  });
});

describe("discoverSkills", () => {
  it("always includes core even when skills.dirs is empty", () => {
    const skills = discoverSkills([], repoRoot);
    assert.equal(skills[0]?.name, CORE_SKILL_NAME);
    assert.ok(skills.some((s) => s.name === CORE_SKILL_NAME));
  });

  it("discovers custom skills from configured dirs", () => {
    const skills = discoverSkills(["skills"], repoRoot);
    assert.ok(skills.some((s) => s.name === CORE_SKILL_NAME));
    assert.ok(skills.some((s) => s.name === "prose-qa"));
  });
});

describe("resolveBaseSkillNames", () => {
  it("always includes core before configured preloads", () => {
    assert.deepEqual(resolveBaseSkillNames([]), [CORE_SKILL_NAME]);
    assert.deepEqual(resolveBaseSkillNames(["prose-qa"]), [
      CORE_SKILL_NAME,
      "prose-qa",
    ]);
    assert.deepEqual(resolveBaseSkillNames([CORE_SKILL_NAME, "prose-qa"]), [
      CORE_SKILL_NAME,
      "prose-qa",
    ]);
  });
});

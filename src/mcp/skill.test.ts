import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  loadCreatePqaScenarioSkill,
  resolveCreatePqaScenarioSkillPath,
} from "./skill.js";
import { getPackageRoot } from "../paths.js";

describe("create-pqa-scenario MCP skill", () => {
  it("resolves skill from package root", () => {
    const root = getPackageRoot();
    const skillPath = resolveCreatePqaScenarioSkillPath(root);
    assert.match(skillPath, /create-pqa-scenario\/SKILL\.md$/);
  });

  it("loads markdown containing scenario authoring sections", () => {
    const text = loadCreatePqaScenarioSkill(getPackageRoot());
    assert.match(text, /name:\s*prose-qa/);
    assert.match(text, /# Goal/);
    assert.match(text, /# Then/);
  });
});

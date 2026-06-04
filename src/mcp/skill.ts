import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getPackageRoot, resolveBundledPath } from "../paths.js";

const SKILL_CANDIDATES = [
  path.join("skills", "create-pqa-scenario", "SKILL.md"),
  path.join(".agents", "skills", "create-pqa-scenario", "SKILL.md"),
];

function resolveFirstExistingSkill(base: string): string | undefined {
  for (const relative of SKILL_CANDIDATES) {
    const resolved = path.resolve(base, relative);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  return undefined;
}

const CREATE_PQA_SCENARIO_SKILL_URI = "pqa://skill/create-pqa-scenario";

export { CREATE_PQA_SCENARIO_SKILL_URI };

export function resolveCreatePqaScenarioSkillPath(cwd: string): string {
  const fromCwd = resolveFirstExistingSkill(cwd);
  if (fromCwd) {
    return fromCwd;
  }
  const fromPkg = resolveFirstExistingSkill(getPackageRoot());
  if (fromPkg) {
    return fromPkg;
  }
  return resolveBundledPath(cwd, SKILL_CANDIDATES[0]!);
}

export function loadCreatePqaScenarioSkill(cwd: string): string {
  const skillPath = resolveCreatePqaScenarioSkillPath(cwd);
  if (!existsSync(skillPath)) {
    throw new Error(
      `create-pqa-scenario skill not found at ${skillPath}. ` +
        "Expected skills/create-pqa-scenario/SKILL.md in the project or package.",
    );
  }
  return readFileSync(skillPath, "utf-8");
}

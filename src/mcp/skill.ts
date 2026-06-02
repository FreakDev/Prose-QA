import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getPackageRoot, resolveBundledPath } from "../paths.js";

const SKILL_RELATIVE = path.join(
  ".agents",
  "skills",
  "create-pqa-scenario",
  "SKILL.md",
);

const CREATE_PQA_SCENARIO_SKILL_URI = "pqa://skill/create-pqa-scenario";

export { CREATE_PQA_SCENARIO_SKILL_URI };

export function resolveCreatePqaScenarioSkillPath(cwd: string): string {
  const cwdPath = path.resolve(cwd, SKILL_RELATIVE);
  if (existsSync(cwdPath)) {
    return cwdPath;
  }
  const bundled = path.resolve(getPackageRoot(), SKILL_RELATIVE);
  if (existsSync(bundled)) {
    return bundled;
  }
  return resolveBundledPath(cwd, SKILL_RELATIVE);
}

export function loadCreatePqaScenarioSkill(cwd: string): string {
  const skillPath = resolveCreatePqaScenarioSkillPath(cwd);
  if (!existsSync(skillPath)) {
    throw new Error(
      `create-pqa-scenario skill not found at ${skillPath}. ` +
        "Expected .agents/skills/create-pqa-scenario/SKILL.md in the project or package.",
    );
  }
  return readFileSync(skillPath, "utf-8");
}

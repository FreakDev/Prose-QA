import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  SkillFrontmatterSchema,
  type Skill,
  type SkillCatalogEntry,
} from "../types/skill.js";
import { resolveBundledPath } from "../paths.js";

const SKILL_FILE = "SKILL.md";

function findSkillDirs(root: string): string[] {
  const results: string[] = [];
  if (!existsSync(root)) return results;

  const walk = (dir: string): void => {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (existsSync(path.join(full, SKILL_FILE))) {
          results.push(full);
        } else {
          walk(full);
        }
      }
    }
  };
  walk(root);
  return results;
}

function parseSkillDir(dir: string): Skill {
  const content = readFileSync(path.join(dir, SKILL_FILE), "utf-8");
  const { data, content: body } = matter(content);
  const frontmatter = SkillFrontmatterSchema.parse(data);

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    dir,
    frontmatter,
    body: body.trim(),
  };
}

export function discoverSkills(dirs: string[], cwd: string): Skill[] {
  const seen = new Set<string>();
  const skills: Skill[] = [];

  for (const dir of dirs) {
    const resolved = path.isAbsolute(dir)
      ? dir
      : resolveBundledPath(cwd, dir);
    for (const skillDir of findSkillDirs(resolved)) {
      const skill = parseSkillDir(skillDir);
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }

  return skills;
}

export function catalog(skills: Skill[]): SkillCatalogEntry[] {
  return skills.map(({ body: _body, ...entry }) => entry);
}

export function getSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name === name);
}

export function requireSkills(
  skills: Skill[],
  names: string[],
): Skill[] {
  const missing = names.filter((n) => !getSkill(skills, n));
  if (missing.length > 0) {
    throw new Error(
      `Missing required skills: ${missing.join(", ")}. Run: npm ci (or npm install) in the prose-qa package.`,
    );
  }
  return names.map((n) => getSkill(skills, n)!);
}

export function mergeSkillNames(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const name of group) {
      if (seen.has(name)) continue;
      seen.add(name);
      merged.push(name);
    }
  }
  return merged;
}

export function resolveSkills(
  catalog: Skill[],
  ...nameGroups: string[][]
): Skill[] {
  return requireSkills(catalog, mergeSkillNames(...nameGroups));
}

export function buildSkillPrompt(
  skills: Skill[],
  options?: { onDemandCatalog?: string },
): string {
  const blocks = skills.map((s) => `## Skill: ${s.name}\n\n${s.body}`);
  if (options?.onDemandCatalog?.trim()) {
    blocks.push(options.onDemandCatalog.trim());
  }
  return blocks.join("\n\n---\n\n");
}

export function verifyBundledSkill(cwd: string): void {
  const skillDir = path.join(
    resolveBundledPath(cwd, "skills"),
    "agent-browser",
  );
  const skillPath = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(
      "skills/agent-browser/SKILL.md missing. Run: npm ci (or npm install) in the prose-qa package.",
    );
  }
  const manifestPath = path.join(skillDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      "skills/agent-browser/manifest.json missing. Run: pqa skills sync (or npm install).",
    );
  }
}

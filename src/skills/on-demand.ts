import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveBundledPath } from "../paths.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import { discoverSkills, getSkill } from "./loader.js";

export type SkillLoadKind = "reference" | "template" | "skill" | "custom";

export interface SkillManifest {
  version: number;
  core: {
    references: string[];
    templates: string[];
  };
  bundled: Array<{ name: string; description: string }>;
}

const DEFAULT_MAX_CHARS = 50_000;

export function resolveAgentBrowserSkillRoot(cwd: string): string {
  return resolveBundledPath(cwd, path.join("skills", "agent-browser"));
}

export function readSkillManifest(cwd: string): SkillManifest | null {
  const manifestPath = path.join(resolveAgentBrowserSkillRoot(cwd), "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as SkillManifest;
  } catch {
    return null;
  }
}

function truncate(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, maxChars)}\n\n[… truncated at ${maxChars} characters — use a narrower reference]`,
    truncated: true,
  };
}

function readReference(root: string, name: string): string {
  const filePath = path.join(root, "references", `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Reference not found: ${name}`);
  }
  return readFileSync(filePath, "utf8").trim();
}

function readTemplate(root: string, name: string): string {
  const filePath = path.join(root, "templates", `${name}.sh`);
  if (!existsSync(filePath)) {
    throw new Error(`Template not found: ${name}`);
  }
  return readFileSync(filePath, "utf8").trim();
}

function readBundledSkill(root: string, name: string): string | null {
  const filePath = path.join(root, "bundled", name, "SKILL.md");
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  return raw.replace(/^---[\s\S]*?---\r?\n?/, "").trim();
}

function readCustomSkill(
  cwd: string,
  skillDirs: string[],
  name: string,
): string {
  const skills = discoverSkills(skillDirs, cwd);
  const skill = getSkill(skills, name);
  if (!skill) {
    throw new Error(
      `Custom skill not found: ${name}. Add a SKILL.md under skills.dirs (configured in pqa.config) with matching frontmatter name.`,
    );
  }
  return skill.body;
}

export function listLoadableCustomSkills(
  cwd: string,
  skillDirs: string[],
  preloadedNames: Set<string>,
): Skill[] {
  return discoverSkills(skillDirs, cwd).filter(
    (s) => !preloadedNames.has(s.name),
  );
}

export interface SkillLoadResult {
  kind: SkillLoadKind;
  name: string;
  content: string;
  truncated: boolean;
  alreadyLoaded: boolean;
}

export interface SkillLoadRegistryOptions {
  maxChars?: number;
  /** Directories scanned for user SKILL.md files (pqa.config skills.dirs). */
  skillDirs?: string[];
  /** Skill names already injected in the system prompt — load_skill returns alreadyLoaded. */
  preloadedNames?: Iterable<string>;
}

export class SkillLoadRegistry {
  private readonly loaded = new Set<string>();
  private readonly maxChars: number;
  private readonly skillDirs: string[];
  private readonly preloadedNames: Set<string>;

  constructor(options: SkillLoadRegistryOptions | number = {}) {
    const resolved =
      typeof options === "number" ? { maxChars: options } : options;
    this.maxChars = resolved.maxChars ?? DEFAULT_MAX_CHARS;
    this.skillDirs = resolved.skillDirs ?? [];
    this.preloadedNames = new Set(resolved.preloadedNames ?? []);
  }

  private key(kind: SkillLoadKind, name: string): string {
    return `${kind}:${name}`;
  }

  has(kind: SkillLoadKind, name: string): boolean {
    return this.loaded.has(this.key(kind, name));
  }

  mark(kind: SkillLoadKind, name: string): void {
    this.loaded.add(this.key(kind, name));
  }

  private alreadyPreloaded(kind: SkillLoadKind, name: string): boolean {
    if (kind !== "skill" && kind !== "custom") return false;
    return this.preloadedNames.has(name);
  }

  load(cwd: string, kind: SkillLoadKind, name: string): SkillLoadResult {
    const normalized = name.trim();
    const key = this.key(kind, normalized);
    if (this.loaded.has(key)) {
      return {
        kind,
        name: normalized,
        content: `Already loaded: ${kind} "${normalized}". Use the content from the earlier load_skill result.`,
        truncated: false,
        alreadyLoaded: true,
      };
    }

    if (this.alreadyPreloaded(kind, normalized)) {
      return {
        kind,
        name: normalized,
        content: `Skill "${normalized}" is already preloaded in the system prompt.`,
        truncated: false,
        alreadyLoaded: true,
      };
    }

    const root = resolveAgentBrowserSkillRoot(cwd);
    let raw: string;
    switch (kind) {
      case "reference":
        raw = readReference(root, normalized);
        break;
      case "template":
        raw = readTemplate(root, normalized);
        break;
      case "custom":
        raw = readCustomSkill(cwd, this.skillDirs, normalized);
        break;
      case "skill": {
        const bundled = readBundledSkill(root, normalized);
        if (bundled) {
          raw = bundled;
          break;
        }
        raw = readCustomSkill(cwd, this.skillDirs, normalized);
        break;
      }
      default:
        throw new Error(`Unknown skill load kind: ${kind satisfies never}`);
    }

    const { content, truncated } = truncate(raw, this.maxChars);
    this.loaded.add(key);

    return {
      kind,
      name: normalized,
      content,
      truncated,
      alreadyLoaded: false,
    };
  }
}

export function formatOnDemandCatalog(
  cwd: string,
  skills: Skill[],
  options?: { skillDirs?: string[] },
): string {
  const core = skills.find((s) => s.name === "core");
  if (!core) return "";

  const skillDirs = options?.skillDirs ?? [];
  const preloaded = new Set(skills.map((s) => s.name));
  const customSkills = listLoadableCustomSkills(cwd, skillDirs, preloaded);

  const manifest = readSkillManifest(cwd);
  if (!manifest) {
    const customLines = customSkills
      .map((s) => `- custom \`${s.name}\` — ${s.description}`)
      .join("\n");
    return [
      "## On-demand skill loading",
      "",
      "Use the `load_skill` tool when you need detailed agent-browser docs beyond this core summary.",
      "Run `pqa skills sync` (or `npm install`) if references are missing.",
      "",
      "**Custom skills** (load_skill kind=custom or kind=skill):",
      customLines || "- (none — add SKILL.md under skills.dirs)",
    ].join("\n");
  }

  const refLines = manifest.core.references.map((r) => `- reference \`${r}\``).join("\n");
  const tplLines = manifest.core.templates.map((t) => `- template \`${t}\``).join("\n");
  const bundledLines = manifest.bundled
    .map((b) => `- skill \`${b.name}\` — ${b.description || "bundled skill"}`)
    .join("\n");
  const customLines = customSkills
    .map((s) => `- custom \`${s.name}\` — ${s.description}`)
    .join("\n");

  return [
    "## On-demand skill loading",
    "",
    "Only preloaded skills appear in the system prompt above. Load everything else with `load_skill`",
    "— do **not** run `agent-browser skills get` in bash (wastes turns).",
    "",
    "**Available references** (load_skill kind=reference):",
    refLines || "- (none)",
    "",
    "**Available templates** (load_skill kind=template):",
    tplLines || "- (none)",
    "",
    "**Bundled agent-browser skills** (load_skill kind=skill):",
    bundledLines || "- (none)",
    "",
    "**Custom project skills** (load_skill kind=custom, or kind=skill as fallback):",
    customLines || "- (none — add SKILL.md under skills.dirs in pqa.config)",
    "",
    "Load sparingly: one item at a time, only when the current step requires it.",
  ].join("\n");
}

/** References the harness auto-injects before the agent runs (context-aware). */
export function inferAutoSkillLoads(_options: {
  scenario: Scenario;
}): Array<{ kind: SkillLoadKind; name: string; reason: string }> {
  return [];
}

export function formatAutoLoadedMessage(
  loads: SkillLoadResult[],
): string | null {
  if (loads.length === 0) return null;

  const blocks = loads
    .filter((l) => !l.alreadyLoaded)
    .map(
      (l) =>
        `### Auto-loaded ${l.kind}: ${l.name}\n\n${l.content}`,
    );

  if (blocks.length === 0) return null;

  return [
    "## Harness auto-loaded skill references",
    "",
    "The harness preloaded these references for this scenario. Do not reload them.",
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n");
}

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type {
  ParsedCheckpoint,
  Scenario,
  ScenarioFrontmatter,
  ScenarioTagFilterExpression,
} from "../types/scenario.js";

const SECTION_HEADERS = ["goal", "steps", "then"] as const;
type SectionName = (typeof SECTION_HEADERS)[number];

function stripInlineYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (
      ch === "#" &&
      !inSingle &&
      !inDouble &&
      (i === 0 || /\s/.test(line[i - 1]!))
    ) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function stripYamlComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return "";
      return stripInlineYamlComment(line);
    })
    .join("\n");
}

function stripBodyComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "");
}

export function stripScenarioComments(raw: string): string {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!fmMatch) {
    return stripBodyComments(raw);
  }
  const frontmatter = stripYamlComments(fmMatch[1]!);
  const body = stripBodyComments(raw.slice(fmMatch[0].length));
  return `---\n${frontmatter}\n---${body}`;
}

export function parseCheckpoints(lines: string[]): ParsedCheckpoint[] {
  return lines.map((raw) => {
    const trimmed = raw.replace(/^-\s*/, "").trim();
    const urlMatch = /^url contains ["'](.+?)["']$/i.exec(trimmed);
    if (urlMatch) {
      return { raw: trimmed, kind: "url_contains" as const, value: urlMatch[1] };
    }
    const pageMatch = /^page shows ["'](.+?)["']$/i.exec(trimmed);
    if (pageMatch) {
      return { raw: trimmed, kind: "page_shows" as const, value: pageMatch[1] };
    }
    const equalsMatch = /^(.+?) equals ["'](.+?)["']$/i.exec(trimmed);
    if (equalsMatch) {
      return {
        raw: trimmed,
        kind: "semantic" as const,
        value: `${equalsMatch[1]} = ${equalsMatch[2]}`,
      };
    }
    return { raw: trimmed, kind: "unknown" as const };
  });
}

const MARKDOWN_LINK_RE =
  /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

function isScenarioMarkdownLink(target: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  return /\.md$/i.test(target);
}

function resolveScenarioLinkPath(fromFilePath: string, target: string): string {
  return path.isAbsolute(target)
    ? path.normalize(target)
    : path.resolve(path.dirname(fromFilePath), target);
}

function normalizeSkillNames(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === "string") return [value];
  return [];
}

function appendSkillNames(collected: string[], names: string[]): void {
  const seen = new Set(collected);
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    collected.push(name);
  }
}

function readLinkedScenarioBody(
  targetPath: string,
  visiting: Set<string>,
  collectedSkills: string[],
): string {
  const resolved = path.resolve(targetPath);
  if (visiting.has(resolved)) {
    const chain = [...visiting, resolved].join(" -> ");
    throw new Error(`Circular scenario include: ${chain}`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`Scenario link target not found: ${targetPath}`);
  }

  visiting.add(resolved);
  try {
    const raw = stripScenarioComments(readFileSync(resolved, "utf-8"));
    const { data, content } = matter(raw);
    const linkedFrontmatter = data as ScenarioFrontmatter;
    appendSkillNames(collectedSkills, normalizeSkillNames(linkedFrontmatter.skills));
    return expandScenarioLinks(content, resolved, visiting, collectedSkills);
  } finally {
    visiting.delete(resolved);
  }
}

export function expandScenarioLinks(
  body: string,
  fromFilePath: string,
  visiting: Set<string> = new Set(),
  collectedSkills: string[] = [],
): string {
  const resolvedFrom = path.resolve(fromFilePath);
  if (!visiting.has(resolvedFrom)) {
    visiting.add(resolvedFrom);
  }

  return body.replace(MARKDOWN_LINK_RE, (match, _label, target: string) => {
    if (!isScenarioMarkdownLink(target)) return match;

    const linkedPath = resolveScenarioLinkPath(fromFilePath, target);
    return readLinkedScenarioBody(linkedPath, visiting, collectedSkills);
  });
}

export function isRunnableScenario(scenario: Scenario): boolean {
  return !scenario.frontmatter.partial;
}

function extractSections(body: string): Record<SectionName, string> {
  const sections: Record<SectionName, string> = {
    goal: "",
    steps: "",
    then: "",
  };
  let current: SectionName | null = null;
  const lines = body.split("\n");

  for (const line of lines) {
    const header = /^#\s+(\w+)\s*$/i.exec(line.trim());
    if (header) {
      const name = header[1]!.toLowerCase() as SectionName;
      if (SECTION_HEADERS.includes(name)) {
        current = name;
        continue;
      }
    }
    if (current) {
      sections[current] += `${line}\n`;
    }
  }

  return sections;
}

export function parseScenarioFile(filePath: string): Scenario {
  const resolvedPath = path.resolve(filePath);
  const raw = stripScenarioComments(readFileSync(resolvedPath, "utf-8"));
  const { data, content } = matter(raw);
  const frontmatter = data as ScenarioFrontmatter;

  if (!frontmatter.name) {
    throw new Error(`Scenario ${resolvedPath} missing 'name' in frontmatter`);
  }

  const collectedSkills: string[] = [];
  appendSkillNames(collectedSkills, normalizeSkillNames(frontmatter.skills));
  const expandedBody = expandScenarioLinks(
    content,
    resolvedPath,
    new Set(),
    collectedSkills,
  );
  const sections = extractSections(expandedBody);
  const thenLines = sections.then
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"));

  const checkpoints = parseCheckpoints(thenLines);

  return {
    filePath: resolvedPath,
    frontmatter,
    skills: collectedSkills,
    goal: sections.goal.trim(),
    steps: sections.steps.trim(),
    then: checkpoints.map((c) => c.raw),
    rawCheckpoints: thenLines,
    checkpoints,
  };
}

export function formatScenarioForPrompt(scenario: Scenario): string {
  const thenBlock =
    scenario.then.length > 0
      ? scenario.then.map((t) => `- ${t}`).join("\n")
      : "(none)";

  const urlLine = scenario.frontmatter.url
    ? `\nStart URL: ${scenario.frontmatter.url}`
    : "";

  return `# Scenario: ${scenario.frontmatter.name}${urlLine}

## Goal
${scenario.goal || "(none)"}

## Steps
${scenario.steps || "(none)"}

## Then (verify each)
${thenBlock}`;
}

function matchesTagTerm(scenarioTags: Set<string>, term: string): boolean {
  const negated = term.startsWith("!");
  const tag = negated ? term.slice(1) : term;
  if (!tag) return false;

  const hasTag = scenarioTags.has(tag);
  return negated ? !hasTag : hasTag;
}

export function matchesTags(
  scenario: Scenario,
  filters: ScenarioTagFilterExpression | string[] | undefined,
): boolean {
  if (!filters || filters.length === 0) return true;

  const filterGroups =
    typeof filters[0] === "string"
      ? (filters as string[]).filter(Boolean).map((tag) => [tag])
      : (filters as ScenarioTagFilterExpression)
          .map((group) => group.filter(Boolean))
          .filter((group) => group.length > 0);

  if (filterGroups.length === 0) return true;

  const scenarioTags = new Set(scenario.frontmatter.tags ?? []);
  return filterGroups.some((group) =>
    group.every((term) => matchesTagTerm(scenarioTags, term)),
  );
}

import { readFileSync } from "node:fs";
import matter from "gray-matter";
import type {
  ParsedCheckpoint,
  Scenario,
  ScenarioFrontmatter,
} from "../types/scenario.js";

const SECTION_HEADERS = ["goal", "steps", "then"] as const;
type SectionName = (typeof SECTION_HEADERS)[number];

function parseCheckpoints(lines: string[]): ParsedCheckpoint[] {
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
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const frontmatter = data as ScenarioFrontmatter;

  if (!frontmatter.name) {
    throw new Error(`Scenario ${filePath} missing 'name' in frontmatter`);
  }

  const sections = extractSections(content);
  const thenLines = sections.then
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"));

  const checkpoints = parseCheckpoints(thenLines);

  return {
    filePath,
    frontmatter,
    goal: sections.goal.trim(),
    steps: sections.steps.trim(),
    then: checkpoints.map((c) => c.raw),
    rawCheckpoints: thenLines,
  };
}

export function formatScenarioForPrompt(scenario: Scenario): string {
  const thenBlock =
    scenario.then.length > 0
      ? scenario.then.map((t) => `- ${t}`).join("\n")
      : "(none)";

  return `# Scenario: ${scenario.frontmatter.name}

## Goal
${scenario.goal || "(none)"}

## Steps
${scenario.steps || "(none)"}

## Then (verify each)
${thenBlock}`;
}

export function matchesTags(
  scenario: Scenario,
  tags: string[] | undefined,
): boolean {
  if (!tags || tags.length === 0) return true;
  const scenarioTags = scenario.frontmatter.tags ?? [];
  return tags.some((t) => scenarioTags.includes(t));
}

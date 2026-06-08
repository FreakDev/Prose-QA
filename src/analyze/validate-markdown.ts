import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseScenarioFile, stripScenarioComments } from "../scenarios/parser.js";

export function normalizeScenarioMarkdown(markdown: string): string {
  return `${stripScenarioComments(markdown).trim()}\n`;
}

export function validateScenarioMarkdown(
  markdown: string,
  hintBasename = "draft.md",
): void {
  const normalized = normalizeScenarioMarkdown(markdown);
  const dir = mkdtempSync(path.join(tmpdir(), "pqa-analyze-"));
  const draft = path.join(dir, hintBasename);
  writeFileSync(draft, normalized, "utf-8");
  try {
    parseScenarioFile(draft);
  } finally {
    try {
      unlinkSync(draft);
    } catch {
      /* ignore */
    }
  }
}

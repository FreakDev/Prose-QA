import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseScenarioContent } from "../scenarios/parser.js";
import type { Scenario } from "../types/scenario.js";

export function writeInlineScenarioFile(
  content: string,
  cwd: string,
): { filePath: string; scenario: Scenario } {
  const dir = mkdtempSync(path.join(tmpdir(), "pqa-mcp-"));
  const filePath = path.join(dir, "scenario.md");
  writeFileSync(filePath, content, "utf-8");
  const scenario = parseScenarioContent(content, filePath);
  return { filePath, scenario };
}

export function validateInlineScenarioContent(
  content: string,
  cwd: string,
): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  try {
    const probePath = path.join(cwd, ".pqa", "mcp-validate-probe.md");
    const scenario = parseScenarioContent(content, probePath);
    return { ok: true, scenario };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { resolveBundledPath } from "../paths.js";

export const DEFAULT_SYSTEM_PROMPT_PATH = "prompt/SYSTEM.md";

export function resolveSystemPromptPath(cwd: string, configPath?: string): string {
  const relative = configPath ?? DEFAULT_SYSTEM_PROMPT_PATH;
  if (path.isAbsolute(relative)) {
    return relative;
  }
  return resolveBundledPath(cwd, relative);
}

export function loadSystemPrompt(cwd: string, configPath?: string): string {
  const resolved = resolveSystemPromptPath(cwd, configPath);
  if (!existsSync(resolved)) {
    throw new Error(
      `System prompt not found at ${resolved}. Expected ${DEFAULT_SYSTEM_PROMPT_PATH} relative to the project root or bundled in the prose-qa package.`,
    );
  }
  return readFileSync(resolved, "utf-8").trim();
}

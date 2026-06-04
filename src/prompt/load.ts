import { readFileSync, existsSync } from "node:fs";
import { resolveBundledPath } from "../paths.js";

export const DEFAULT_SYSTEM_PROMPT_PATH = "prompt/SYSTEM.md";

export function resolveSystemPromptPath(cwd: string): string {
  return resolveBundledPath(cwd, DEFAULT_SYSTEM_PROMPT_PATH);
}

export function loadSystemPrompt(cwd: string): string {
  const resolved = resolveSystemPromptPath(cwd);
  if (!existsSync(resolved)) {
    throw new Error(
      `System prompt not found at ${resolved}. Expected ${DEFAULT_SYSTEM_PROMPT_PATH} relative to the project root or bundled in the prose-qa package.`,
    );
  }
  return readFileSync(resolved, "utf-8").trim();
}

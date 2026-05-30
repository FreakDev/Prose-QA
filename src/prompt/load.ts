import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_SYSTEM_PROMPT_PATH = "prompt/SYSTEM.md";

export function resolveSystemPromptPath(cwd: string, configPath?: string): string {
  return path.resolve(cwd, configPath ?? DEFAULT_SYSTEM_PROMPT_PATH);
}

export function loadSystemPrompt(cwd: string, configPath?: string): string {
  const resolved = resolveSystemPromptPath(cwd, configPath);
  if (!existsSync(resolved)) {
    throw new Error(
      `System prompt not found at ${resolved}. Expected ${DEFAULT_SYSTEM_PROMPT_PATH} relative to the project root.`,
    );
  }
  return readFileSync(resolved, "utf-8").trim();
}

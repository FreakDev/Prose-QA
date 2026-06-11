import type { PqaConfig } from "../types/config.js";

/**
 * Helper function for type-safe PQA config definitions.
 *
 * Usage in `pqa.config.ts`:
 * ```ts
 * import { defineConfig } from "prose-qa/define-config";
 *
 * export default defineConfig({
 *   llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
 *   // ...
 * });
 * ```
 */
export function defineConfig(config: PqaConfig): PqaConfig {
  return config;
}

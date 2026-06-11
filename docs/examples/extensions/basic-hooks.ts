import type {
  PreScenarioHook,
  PostToolHook,
  PostScenarioHook,
  HookContext,
  PreSystemPromptHook,
} from "../../../src/types/hooks.js";

// ──────────────────────────────────────────────
// Example: Pre-scenario logger hook
//
// Logs the scenario name before execution and
// always continues. Useful for auditing.
// ──────────────────────────────────────────────
export const logScenarioName: PreScenarioHook = async (
  scenario,
  ctx: HookContext,
) => {
  ctx.logger.info(`Starting scenario: ${scenario.frontmatter.name}`);
  return { action: "continue" };
};

// ──────────────────────────────────────────────
// Example: Post-tool sentry hook
//
// Aborts the scenario if a bash command fails
// with a non-zero exit code. Useful for strict
// environments where any command failure is fatal.
// ──────────────────────────────────────────────
export const abortOnToolFailure: PostToolHook = async (entry, ctx) => {
  if (entry.exitCode !== 0) {
    ctx.logger.error(
      `Command failed with exit code ${entry.exitCode}: ${entry.command}`,
    );
    return {
      action: "abort",
      error: `Tool failed: ${entry.command} (exit ${entry.exitCode})`,
    };
  }
  return { action: "continue" };
};

// ──────────────────────────────────────────────
// Example: Post-scenario custom log file writer
//
// Writes a custom JSON log file after each scenario
// with scenario name, status, and duration.
// ──────────────────────────────────────────────
import { writeFileSync } from "node:fs";
import path from "node:path";

export const writeCustomLog: PostScenarioHook = async (result, ctx) => {
  const logEntry = {
    scenario: result.scenario,
    status: result.status,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  };
  const logPath = path.join(ctx.cwd, ".pqa", "custom-hook-log.jsonl");
  writeFileSync(logPath, JSON.stringify(logEntry) + "\n", { flag: "a" });
  return {};
};

// ──────────────────────────────────────────────
// Example: Pre-system-prompt injector
//
// Injects additional instructions into the system
// prompt. Useful for adding custom rules.
// ──────────────────────────────────────────────
export const addCustomInstructions: PreSystemPromptHook = async (
  params,
  ctx,
) => {
  return {
    extraInstructions: [
      "## Custom instructions from extension hook",
      "- Always use full page screenshots for verification",
      "- Include step numbers in all comments",
    ].join("\n"),
  };
};

// ──────────────────────────────────────────────
// Usage in pqa.config.ts:
//
// import { defineConfig } from "prose-qa/define-config";
//
// export default defineConfig({
//   // ... other config ...
//   extensions: {
//     hooks: {
//       preScenario: [logScenarioName],
//       preSystemPrompt: [addCustomInstructions],
//       postTool: [abortOnToolFailure],
//       postScenario: [writeCustomLog],
//     },
//   },
// });
// ──────────────────────────────────────────────

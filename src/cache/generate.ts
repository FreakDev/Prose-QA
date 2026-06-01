import { readFileSync } from "node:fs";
import { generateText } from "ai";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { ScenarioResult } from "../types/verdict.js";
import { createLlmModel } from "../agent/llm-model.js";
import { buildProviderOptions } from "../agent/provider-options.js";
import { truncateScenarioResult } from "../analyze/build-context.js";
import { formatScenarioForPrompt } from "../scenarios/parser.js";
import { resolveBundledPath } from "../paths.js";
import {
  readScenarioCacheMeta,
  writeScenarioCache,
  loadScenarioCache,
} from "./store.js";

function buildCacheUserPrompt(
  scenario: Scenario,
  result: ScenarioResult,
  existingHints?: string,
): string {
  const truncated = truncateScenarioResult(result);
  const parts = [
    "## Scenario",
    formatScenarioForPrompt(scenario),
    "",
    "## Successful run",
    "```json",
    JSON.stringify(
      {
        durationMs: truncated.durationMs,
        verdict: truncated.verdict,
        healing: truncated.healing,
        transcript: truncated.transcript,
      },
      null,
      2,
    ),
    "```",
  ];

  if (existingHints?.trim()) {
    parts.push(
      "",
      "## Existing hints (merge and improve)",
      existingHints.trim(),
    );
  }

  parts.push(
    "",
    "Produce updated scenario replay hints for the next agent run. " +
      "Only include advice specific to this scenario and transcript — no generic testing tips.",
  );

  return parts.join("\n");
}

export async function generateOrMergeScenarioCacheHints(
  config: PqaConfig,
  cwd: string,
  scenario: Scenario,
  result: ScenarioResult,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const systemPath = resolveBundledPath(cwd, "prompt/CACHE-HINTS.md");
    const system = readFileSync(systemPath, "utf-8");
    const name = scenario.frontmatter.name;
    const existingHints = loadScenarioCache(cwd, config, scenario);
    const existingMeta = readScenarioCacheMeta(cwd, config, name);

    const { text } = await generateText({
      model: createLlmModel(config),
      system,
      prompt: buildCacheUserPrompt(scenario, result, existingHints),
      maxOutputTokens: 4096,
      // force thinking off for cache hints generation
      providerOptions: buildProviderOptions({
        ...config,
        llm: { ...config.llm, thinking: { enabled: false } },
      }),
    });

    const hints = text.trim();
    if (!hints) {
      return { ok: false, error: "LLM returned empty hints" };
    }

    writeScenarioCache(cwd, config, scenario, hints, existingMeta);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

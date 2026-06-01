import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LlmReasoningEffort, PqaConfig } from "../types/config.js";

const DEFAULT_THINKING_BUDGET = 10_000;

type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

function thinkingBudget(config: PqaConfig): number {
  return config.llm.thinking?.budgetTokens ?? DEFAULT_THINKING_BUDGET;
}

function isThinkingEnabled(config: PqaConfig): boolean {
  return config.llm.thinking?.enabled === true;
}

/** Derive OpenAI reasoning effort from token budget when `reasoningEffort` is unset. */
function reasoningEffortFromBudget(budgetTokens: number): LlmReasoningEffort {
  if (budgetTokens <= 2_000) return "minimal";
  if (budgetTokens <= 5_000) return "low";
  if (budgetTokens <= 10_000) return "medium";
  if (budgetTokens <= 20_000) return "high";
  return "xhigh";
}

function resolveOpenAIReasoningEffort(config: PqaConfig): LlmReasoningEffort {
  const explicit = config.llm.thinking?.reasoningEffort;
  if (explicit != null) return explicit;
  return reasoningEffortFromBudget(thinkingBudget(config));
}

type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

function geminiThinkingLevel(
  reasoningEffort: LlmReasoningEffort | undefined,
  budgetTokens: number,
): GeminiThinkingLevel {
  if (reasoningEffort != null && reasoningEffort !== "none") {
    if (reasoningEffort === "xhigh") return "high";
    if (reasoningEffort === "minimal") return "minimal";
    return reasoningEffort;
  }
  if (budgetTokens <= 2_000) return "minimal";
  if (budgetTokens <= 5_000) return "low";
  if (budgetTokens <= 10_000) return "medium";
  return "high";
}

/** Map config effort to Anthropic `effort` (none/minimal are omitted). */
function anthropicEffort(
  reasoningEffort: LlmReasoningEffort | undefined,
): AnthropicEffort | undefined {
  if (reasoningEffort == null || reasoningEffort === "none") {
    return undefined;
  }
  if (reasoningEffort === "minimal") return "low";
  if (reasoningEffort === "xhigh") return "xhigh";
  return reasoningEffort;
}

/**
 * Provider-specific options for extended thinking / reasoning.
 * Honors `config.llm.thinking.enabled` across Anthropic, OpenAI, Fireworks, Google, OpenRouter, and Ollama.
 */
export function buildProviderOptions(
  config: PqaConfig,
): ProviderOptions | undefined {
  if (!isThinkingEnabled(config)) {
    if (config.llm.provider === "anthropic") {
      return { anthropic: { disableParallelToolUse: true } };
    }
    return undefined;
  }

  const budget = thinkingBudget(config);
  const reasoningEffort = config.llm.thinking?.reasoningEffort;

  switch (config.llm.provider) {
    case "anthropic": {
      const effort = anthropicEffort(reasoningEffort);
      return {
        anthropic: {
          disableParallelToolUse: true,
          thinking: { type: "enabled", budgetTokens: budget },
          ...(effort && { effort }),
        },
      };
    }
    case "openai":
      return {
        openai: {
          reasoningEffort: resolveOpenAIReasoningEffort(config),
        },
      };
    case "fireworks":
      return {
        fireworks: {
          thinking: { type: "enabled", budgetTokens: budget },
        },
      };
    case "google":
      return {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: budget,
            thinkingLevel: geminiThinkingLevel(reasoningEffort, budget),
          },
        },
      };
    case "ollama":
      return {
        ollama: { think: true },
      };
    case "openrouter":
      return {
        openrouter: {
          reasoning: reasoningEffort
            ? { effort: reasoningEffort }
            : { max_tokens: budget },
        },
      };
    default:
      return undefined;
  }
}

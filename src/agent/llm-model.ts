import { createAnthropic } from "@ai-sdk/anthropic";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { PQA_LLM_API_KEY } from "../config/load.js";
import type { PqaConfig } from "../types/config.js";

function llmProviderSettings():
  | { apiKey: string }
  | Record<string, never> {
  const apiKey = process.env[PQA_LLM_API_KEY];
  return apiKey ? { apiKey } : {};
}

function createOpenAiCompatibleProvider(config: PqaConfig) {
  const baseURL = config.llm.baseURL;
  if (!baseURL) {
    throw new Error(
      "llm.baseURL must be set when llm.provider is openai-compatible",
    );
  }
  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL,
    ...llmProviderSettings(),
  });
}

/** Resolve the Vercel AI SDK language model for the configured LLM provider. */
export function createLlmModel(config: PqaConfig): LanguageModel {
  const { provider, model } = config.llm;
  if (!provider || !model) {
    throw new Error("llm.provider and llm.model must be set before creating a model");
  }
  const settings = llmProviderSettings();
  switch (provider) {
    case "anthropic":
      return createAnthropic(settings)(model);
    case "openai":
      return createOpenAI(settings)(model);
    case "fireworks":
      return createFireworks(settings)(model);
    case "openai-compatible":
      return createOpenAiCompatibleProvider(config)(model);
    case "google":
      return createGoogleGenerativeAI(settings)(model);
    case "openrouter":
      return createOpenRouter(settings)(model);
    default: {
      const unsupported: never = provider;
      throw new Error(`Unsupported llm.provider: ${unsupported}`);
    }
  }
}

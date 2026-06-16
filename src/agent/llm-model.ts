import { createAnthropic } from "@ai-sdk/anthropic";
import { createFireworks } from "@ai-sdk/fireworks";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ollama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";
import {
  DEFAULT_LMSTUDIO_BASE_URL,
  PQA_LLM_API_KEY,
} from "../config/load.js";
import type { PqaConfig } from "../types/config.js";

function llmProviderSettings():
  | { apiKey: string }
  | Record<string, never> {
  const apiKey = process.env[PQA_LLM_API_KEY];
  return apiKey ? { apiKey } : {};
}

function createLmstudioProvider(config: PqaConfig) {
  const settings = {
    name: "lmstudio",
    baseURL: config.llm.baseURL ?? DEFAULT_LMSTUDIO_BASE_URL,
    ...llmProviderSettings(),
  };
  return createOpenAICompatible(settings);
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
    case "ollama":
      return ollama(model);
    case "lmstudio":
      return createLmstudioProvider(config)(model);
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

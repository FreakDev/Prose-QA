import { anthropic } from "@ai-sdk/anthropic";
import { fireworks } from "@ai-sdk/fireworks";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { ollama } from "ollama-ai-provider-v2";
import type { LanguageModel } from "ai";
import type { PqaConfig } from "../types/config.js";

/** Resolve the Vercel AI SDK language model for the configured LLM provider. */
export function createLlmModel(config: PqaConfig): LanguageModel {
  const { provider, model } = config.llm;
  switch (provider) {
    case "anthropic":
      return anthropic(model);
    case "openai":
      return openai(model);
    case "fireworks":
      return fireworks(model);
    case "ollama":
      return ollama(model);
    case "google":
      return google(model);
    case "openrouter":
      return openrouter(model);
    default: {
      const unsupported: never = provider;
      throw new Error(`Unsupported llm.provider: ${unsupported}`);
    }
  }
}

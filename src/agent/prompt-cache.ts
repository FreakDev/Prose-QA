import type { ModelMessage } from "ai";
import type { PqaConfig } from "../types/config.js";

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

/** Mark the final message so Anthropic can incrementally cache the growing prefix. */
export function addAnthropicCacheControlToMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  if (messages.length === 0) return messages;

  return messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        ...ANTHROPIC_CACHE_CONTROL,
      },
    };
  });
}

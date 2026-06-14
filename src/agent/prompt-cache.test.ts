import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage } from "ai";
import type { PqaConfig } from "../types/config.js";
import { addAnthropicCacheControlToMessages } from "./prompt-cache.js";

const baseConfig = {
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine: "chrome",
  },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
} satisfies Partial<PqaConfig>;

describe("addAnthropicCacheControlToMessages", () => {
  it("leaves non-final messages unchanged", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];

    const cached = addAnthropicCacheControlToMessages(messages);

    assert.equal(cached[0]?.providerOptions, undefined);
    assert.equal(cached[1]?.providerOptions, undefined);
    assert.deepEqual(cached[2]?.providerOptions, {
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });
});

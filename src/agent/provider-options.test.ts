import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import { buildProviderOptions } from "./provider-options.js";

const base = {
  browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
  auth: {},
} satisfies Partial<PqaConfig>;

function config(
  provider: PqaConfig["llm"]["provider"],
  thinking?: PqaConfig["llm"]["thinking"],
): PqaConfig {
  return {
    ...base,
    llm: { provider, model: "test-model", thinking },
  } as PqaConfig;
}

describe("buildProviderOptions", () => {
  it("returns undefined when thinking is disabled", () => {
    assert.equal(
      buildProviderOptions(config("openai", { enabled: false })),
      undefined,
    );
  });

  it("keeps anthropic parallel tool use off when thinking is disabled", () => {
    assert.deepEqual(
      buildProviderOptions(config("anthropic", { enabled: false })),
      { anthropic: { disableParallelToolUse: true } },
    );
  });

  it("enables anthropic extended thinking with budget", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("anthropic", { enabled: true, budgetTokens: 8_000 }),
      ),
      {
        anthropic: {
          disableParallelToolUse: true,
          thinking: { type: "enabled", budgetTokens: 8_000 },
        },
      },
    );
  });

  it("maps thinking budget to openai reasoning effort when reasoningEffort is unset", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("openai", { enabled: true, budgetTokens: 3_000 }),
      ),
      { openai: { reasoningEffort: "low" } },
    );
    assert.deepEqual(
      buildProviderOptions(
        config("openai", { enabled: true, budgetTokens: 25_000 }),
      ),
      { openai: { reasoningEffort: "xhigh" } },
    );
  });

  it("uses explicit reasoningEffort for openai", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("openai", {
          enabled: true,
          budgetTokens: 25_000,
          reasoningEffort: "medium",
        }),
      ),
      { openai: { reasoningEffort: "medium" } },
    );
  });

  it("maps reasoningEffort to anthropic effort", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("anthropic", {
          enabled: true,
          budgetTokens: 8_000,
          reasoningEffort: "high",
        }),
      ),
      {
        anthropic: {
          disableParallelToolUse: true,
          thinking: { type: "enabled", budgetTokens: 8_000 },
          effort: "high",
        },
      },
    );
  });

  it("omits anthropic effort for none or minimal reasoningEffort", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("anthropic", { enabled: true, reasoningEffort: "none" }),
      ),
      {
        anthropic: {
          disableParallelToolUse: true,
          thinking: { type: "enabled", budgetTokens: 10_000 },
        },
      },
    );
    assert.deepEqual(
      buildProviderOptions(
        config("anthropic", { enabled: true, reasoningEffort: "minimal" }),
      ),
      {
        anthropic: {
          disableParallelToolUse: true,
          thinking: { type: "enabled", budgetTokens: 10_000 },
          effort: "low",
        },
      },
    );
  });

  it("enables fireworks thinking with budget", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("fireworks", { enabled: true, budgetTokens: 12_000 }),
      ),
      {
        fireworks: {
          thinking: { type: "enabled", budgetTokens: 12_000 },
        },
      },
    );
  });

  it("enables google thinking config with explicit reasoningEffort", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("google", {
          enabled: true,
          budgetTokens: 8_000,
          reasoningEffort: "high",
        }),
      ),
      {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: "high",
          },
        },
      },
    );
  });

  it("omits google thinkingLevel when reasoningEffort is none or unset", () => {
    const expected = {
      google: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    };
    assert.deepEqual(
      buildProviderOptions(config("google", { enabled: true })),
      expected,
    );
    assert.deepEqual(
      buildProviderOptions(
        config("google", { enabled: true, reasoningEffort: "none" }),
      ),
      expected,
    );
  });

  it("enables ollama think mode", () => {
    assert.deepEqual(
      buildProviderOptions(config("ollama", { enabled: true })),
      { ollama: { think: true } },
    );
  });

  it("enables openrouter reasoning with budget", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("openrouter", { enabled: true, budgetTokens: 8_000 }),
      ),
      {
        openrouter: {
          reasoning: { max_tokens: 8_000 },
        },
      },
    );
  });

  it("uses explicit reasoningEffort for openrouter", () => {
    assert.deepEqual(
      buildProviderOptions(
        config("openrouter", {
          enabled: true,
          budgetTokens: 8_000,
          reasoningEffort: "high",
        }),
      ),
      {
        openrouter: {
          reasoning: { effort: "high" },
        },
      },
    );
  });
});

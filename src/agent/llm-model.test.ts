import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import { createLlmModel } from "./llm-model.js";

const base = {
  browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000 },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
  auth: {},
} satisfies Partial<PqaConfig>;

describe("createLlmModel", () => {
  it("returns a model for google provider", () => {
    const model = createLlmModel({
      ...base,
      llm: { provider: "google", model: "gemini-2.5-flash" },
    } as PqaConfig);
    assert.ok(model);
    assert.equal(typeof model, "object");
  });
});

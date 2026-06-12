import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createStepIntentCapture,
  createStepIntentMiddleware,
} from "./step-intent.js";

describe("createStepIntentMiddleware", () => {
  it("captures assistant text from generate results", async () => {
    const capture = createStepIntentCapture();
    const middleware = createStepIntentMiddleware(capture);

    await middleware.wrapGenerate!({
      doGenerate: async () => ({
        content: [{ type: "text", text: "Click the Sign in button — @e6" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
      doStream: async () => {
        throw new Error("not used");
      },
      params: {} as never,
      model: {} as never,
    });

    assert.equal(capture.text, "Click the Sign in button — @e6");
  });
});

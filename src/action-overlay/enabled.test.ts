import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isActionOverlayEnabled } from "./enabled.js";
import type { PqaConfig } from "../types/config.js";

const baseConfig = {
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine: "chrome" as const,
  },
  llm: { thinking: { enabled: false } },
  skills: {},
  agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
} satisfies PqaConfig;

describe("isActionOverlayEnabled", () => {
  it("is false when flag is off", () => {
    assert.equal(
      isActionOverlayEnabled({
        config: baseConfig,
        headed: true,
        engine: "chrome",
      }),
      false,
    );
  });

  it("is true when flag on, headed, chrome", () => {
    assert.equal(
      isActionOverlayEnabled({
        actionOverlay: true,
        config: baseConfig,
        headed: true,
        engine: "chrome",
      }),
      true,
    );
  });

  it("is false when headless", () => {
    assert.equal(
      isActionOverlayEnabled({
        actionOverlay: true,
        config: baseConfig,
        headed: false,
        engine: "chrome",
      }),
      false,
    );
  });

  it("is false for lightpanda even when flagged", () => {
    assert.equal(
      isActionOverlayEnabled({
        actionOverlay: true,
        config: baseConfig,
        headed: true,
        engine: "lightpanda",
      }),
      false,
    );
  });

  it("reads enabled from config extensions", () => {
    assert.equal(
      isActionOverlayEnabled({
        config: {
          ...baseConfig,
          extensions: { actionOverlay: { enabled: true } },
        },
        headed: true,
        engine: "chrome",
      }),
      true,
    );
  });
});

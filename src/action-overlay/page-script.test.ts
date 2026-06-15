import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildActionOverlayScript } from "./page-script.js";

const BRIDGE_URL = "http://127.0.0.1:17321";

describe("buildActionOverlayScript", () => {
  it("produces valid JavaScript that defines __pqaOverlay", () => {
    const script = buildActionOverlayScript({ bridgeUrl: BRIDGE_URL });
    const g = globalThis as typeof globalThis & {
      window?: typeof globalThis;
      __pqaOverlay?: {
        showHud: unknown;
        setScenario: unknown;
        setOutcome: unknown;
      };
    };
    g.window = g;

    assert.doesNotThrow(() => {
      new Function(script)();
    });

    assert.ok(g.__pqaOverlay);
    assert.equal(typeof g.__pqaOverlay?.showHud, "function");
    assert.equal(typeof g.__pqaOverlay?.setScenario, "function");
    assert.equal(typeof g.__pqaOverlay?.setOutcome, "function");

    delete g.__pqaOverlay;
  });

  it("embeds the control bridge URL", () => {
    const script = buildActionOverlayScript({ bridgeUrl: BRIDGE_URL });
    assert.match(script, /http:\/\/127\.0\.0\.1:17321/);
  });
});

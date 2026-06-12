import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildActionOverlayScript } from "./page-script.js";

describe("buildActionOverlayScript", () => {
  it("produces valid JavaScript that defines __pqaOverlay", () => {
    const script = buildActionOverlayScript();
    const g = globalThis as typeof globalThis & {
      window?: typeof globalThis;
      __pqaOverlay?: { showHud: unknown };
    };
    g.window = g;

    assert.doesNotThrow(() => {
      new Function(script)();
    });

    assert.ok(g.__pqaOverlay);
    assert.equal(typeof g.__pqaOverlay?.showHud, "function");

    delete g.__pqaOverlay;
  });
});

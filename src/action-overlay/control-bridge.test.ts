import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startOverlayControlBridge } from "./control-bridge.js";

describe("startOverlayControlBridge", () => {
  it("accepts play, pause, and stop control events", async () => {
    const actions: string[] = [];
    const bridge = await startOverlayControlBridge({
      onControl: (action) => actions.push(action),
    });

    try {
      const response = await fetch(`${bridge.url}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      assert.equal(response.status, 204);
      assert.deepEqual(actions, ["pause"]);
    } finally {
      await bridge.close();
    }
  });
});

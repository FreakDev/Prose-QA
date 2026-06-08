import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startRecordingBridge } from "./bridge.js";

describe("recording bridge", () => {
  it("accepts POST /event", async () => {
    const events: unknown[] = [];
    const bridge = await startRecordingBridge({
      port: 0,
      onEvent: (e) => events.push(e),
    });

    const res = await fetch(`${bridge.url}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "comment", text: "test", ts: 1 }),
    });
    assert.equal(res.status, 204);
    assert.equal(events.length, 1);
    await bridge.close();
  });
});

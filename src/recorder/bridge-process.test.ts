import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureRecordingDir, readEvents } from "./events.js";
import {
  isProcessAlive,
  spawnRecordingBridgeWorker,
  stopRecordingBridgeWorker,
} from "./bridge-process.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("recording bridge process", () => {
  it("stays alive after spawn and accepts events until stopped", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-bridge-proc-"));
    ensureRecordingDir(dir);

    const bridge = await spawnRecordingBridgeWorker({
      projectRoot,
      recordingDir: dir,
      port: 0,
    });

    assert.ok(isProcessAlive(bridge.pid));

    const res = await fetch(`${bridge.url}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "click", label: "Save", ts: 1 }),
    });
    assert.equal(res.status, 204);

    await new Promise((r) => setTimeout(r, 100));
    const events = readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "click");

    stopRecordingBridgeWorker(bridge.pid);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(isProcessAlive(bridge.pid), false);

    rmSync(dir, { recursive: true, force: true });
  });
});

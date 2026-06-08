import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  appendEvent,
  readEvents,
  ensureRecordingDir,
  writeMeta,
  readMeta,
} from "./events.js";

describe("recorder events", () => {
  it("appends and reads jsonl events", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pqa-rec-"));
    try {
      ensureRecordingDir(tmp);
      appendEvent(tmp, { type: "comment", text: "hi", ts: 100 });
      appendEvent(tmp, { type: "navigate", url: "https://x.test/", ts: 101 });
      const events = readEvents(tmp);
      assert.equal(events.length, 2);
      assert.equal(events[0]!.type, "comment");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes and reads meta", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pqa-meta-"));
    try {
      ensureRecordingDir(tmp);
      writeMeta(tmp, {
        id: "test-id",
        startedAt: "2026-01-01T00:00:00.000Z",
        sessionName: "pqa-record",
        bridgePort: 17321,
      });
      const meta = readMeta(tmp);
      assert.equal(meta.id, "test-id");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

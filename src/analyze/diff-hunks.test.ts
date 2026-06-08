import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyHunks,
  canSplitHunk,
  computeDiffHunks,
  formatHunkBody,
  splitHunk,
} from "./diff-hunks.js";

describe("computeDiffHunks", () => {
  it("detects a single-line change", () => {
    const hunks = computeDiffHunks("a\nb\nc", "a\nB\nc");
    assert.equal(hunks.length, 1);
    assert.deepEqual(hunks[0]!.removed, ["b"]);
    assert.deepEqual(hunks[0]!.added, ["B"]);
  });

  it("returns empty when files match", () => {
    assert.deepEqual(computeDiffHunks("same", "same"), []);
  });
});

describe("applyHunks", () => {
  it("applies only accepted hunks", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\n");
    const mutated = lines
      .split("\n")
      .map((l, i) => (i === 2 ? "LINE2" : i === 9 ? "LINE9" : l))
      .join("\n");
    const hunks = computeDiffHunks(lines, mutated);
    assert.ok(hunks.length >= 2);

    const result = applyHunks(lines, hunks, new Set([0]));
    assert.match(result, /LINE2/);
    assert.match(result, /line9/);
    assert.doesNotMatch(result, /LINE9/);
  });
});

describe("formatHunkBody", () => {
  it("renders unified diff lines", () => {
    const hunks = computeDiffHunks("a\nb", "a\nc");
    const body = formatHunkBody(hunks[0]!);
    assert.match(body, /^-b/m);
    assert.match(body, /^\+c/m);
  });
});

describe("splitHunk", () => {
  it("splits when multiple change lines exist", () => {
    const hunk = {
      oldStart: 0,
      removed: ["a", "b"],
      added: ["A", "B"],
      contextBefore: [],
      contextAfter: [],
    };
    assert.ok(canSplitHunk(hunk));
    const parts = splitHunk(hunk);
    assert.ok(parts);
    assert.ok(parts![0]!.removed.length >= 1);
    assert.ok(parts![1]!.removed.length >= 1);
  });
});

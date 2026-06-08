import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiffHunk } from "./diff-hunks.js";
import {
  applyHunkList,
  formatHunkForEditor,
  hunkMatchesAt,
  parseEditedHunk,
} from "./hunk-editor.js";

const baseHunk: DiffHunk = {
  oldStart: 1,
  removed: ["old"],
  added: ["new"],
  contextBefore: ["keep"],
  contextAfter: ["tail"],
};

describe("parseEditedHunk", () => {
  it("parses edited patch body", () => {
    const edited = formatHunkForEditor(baseHunk, "scenarios/x.md");
    const parsed = parseEditedHunk(edited, baseHunk);
    assert.ok(parsed);
    assert.deepEqual(parsed!.removed, ["old"]);
    assert.deepEqual(parsed!.added, ["new"]);
    assert.equal(parsed!.oldStart, baseHunk.oldStart);
  });

  it("returns null when all changes removed", () => {
    const edited = `# comment
 keep
 tail
`;
    assert.equal(parseEditedHunk(edited, baseHunk), null);
  });
});

describe("applyHunkList", () => {
  it("applies accepted hunks sequentially", () => {
    const before = "a\nold\nb";
    const hunk: DiffHunk = {
      oldStart: 1,
      removed: ["old"],
      added: ["new"],
      contextBefore: ["a"],
      contextAfter: ["b"],
    };
    assert.equal(applyHunkList(before, [hunk]), "a\nnew\nb");
  });
});

describe("hunkMatchesAt", () => {
  it("checks removed lines at offset", () => {
    const lines = "a\nold\nb".split("\n");
    assert.equal(hunkMatchesAt(lines, baseHunk, 0), true);
    assert.equal(hunkMatchesAt(lines, baseHunk, 1), false);
  });
});

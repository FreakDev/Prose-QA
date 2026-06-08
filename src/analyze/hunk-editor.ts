import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DiffHunk } from "./diff-hunks.js";

const EDITOR_COMMENT = `# Edit the hunk below. Lines starting with:
#   ' ' — context (do not edit)
#   '-' — removed lines
#   '+' — added lines
# Save and close the editor to apply. Delete all +/- lines to cancel the edit.
`;

export function resolveEditor(): string {
  return (
    process.env.VISUAL ??
    process.env.EDITOR ??
    (process.platform === "win32" ? "notepad" : "vi")
  );
}

export function formatHunkForEditor(
  hunk: DiffHunk,
  filePath: string,
): string {
  const lines = [
    EDITOR_COMMENT,
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -${hunk.oldStart + 1} @@`,
    ...hunk.contextBefore.map((line) => ` ${line}`),
    ...hunk.removed.map((line) => `-${line}`),
    ...hunk.added.map((line) => `+${line}`),
    ...hunk.contextAfter.map((line) => ` ${line}`),
    "",
  ];
  return lines.join("\n");
}

export function parseEditedHunk(
  content: string,
  original: DiffHunk,
): DiffHunk | null {
  const bodyLines = content
    .split("\n")
    .filter((line) => !line.startsWith("#"));

  const patchLines = bodyLines.filter(
    (line) =>
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith("@@"),
  );

  if (patchLines.length === 0) return null;

  const contextBefore: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  const contextAfter: string[] = [];
  let phase: "before" | "change" | "after" = "before";

  for (const raw of patchLines) {
    if (raw.startsWith("@@") || raw.startsWith("---") || raw.startsWith("+++")) {
      continue;
    }

    const prefix = raw[0];
    const line = raw.slice(1);

    if (prefix === " ") {
      if (phase === "before") contextBefore.push(line);
      else if (phase === "change") {
        phase = "after";
        contextAfter.push(line);
      } else {
        contextAfter.push(line);
      }
    } else if (prefix === "-") {
      phase = "change";
      removed.push(line);
    } else if (prefix === "+") {
      phase = "change";
      added.push(line);
    }
  }

  if (removed.length === 0 && added.length === 0) {
    return null;
  }

  return {
    oldStart: original.oldStart,
    removed,
    added,
    contextBefore,
    contextAfter,
  };
}

export function hunkMatchesAt(
  fileLines: string[],
  hunk: DiffHunk,
  lineOffset: number,
): boolean {
  const start = hunk.oldStart + lineOffset;
  if (start < 0 || start + hunk.removed.length > fileLines.length) {
    return false;
  }
  for (let i = 0; i < hunk.removed.length; i++) {
    if (fileLines[start + i] !== hunk.removed[i]) {
      return false;
    }
  }
  return true;
}

export function editHunkInEditor(
  hunk: DiffHunk,
  filePath: string,
): DiffHunk | null {
  const initial = formatHunkForEditor(hunk, filePath);
  const tmpDir = mkdtempSync(path.join(tmpdir(), "pqa-hunk-edit-"));
  const tmpFile = path.join(tmpDir, "hunk.patch");

  writeFileSync(tmpFile, initial, "utf-8");
  const editor = resolveEditor();
  const result = spawnSync(editor, [tmpFile], {
    stdio: "inherit",
    env: process.env,
  });

  const edited = readFileSync(tmpFile, "utf-8");

  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }

  if (result.error || (result.status !== 0 && result.status !== null)) {
    return null;
  }

  return parseEditedHunk(edited, hunk);
}

export function applyHunkList(original: string, accepted: DiffHunk[]): string {
  const lines = original.split("\n");
  let offset = 0;

  for (const hunk of accepted) {
    const start = hunk.oldStart + offset;
    if (!hunkMatchesAt(lines, hunk, offset)) {
      throw new Error(
        `Hunk at line ${hunk.oldStart + 1} no longer applies cleanly to the file`,
      );
    }
    lines.splice(start, hunk.removed.length, ...hunk.added);
    offset += hunk.added.length - hunk.removed.length;
  }

  return lines.join("\n");
}

export interface DiffHunk {
  /** 0-based line index in the original file where removed lines start (or insertion point). */
  oldStart: number;
  removed: string[];
  added: string[];
  contextBefore: string[];
  contextAfter: string[];
}

const CONTEXT_LINES = 3;

type DiffOp =
  | { type: "equal"; line: string; oldIndex: number; newIndex: number }
  | { type: "delete"; line: string; oldIndex: number }
  | { type: "insert"; line: string; newIndex: number };

function diffOps(beforeLines: string[], afterLines: string[]): DiffOp[] {
  const m = beforeLines.length;
  const n = afterLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      ops.push({
        type: "equal",
        line: beforeLines[i - 1]!,
        oldIndex: i - 1,
        newIndex: j - 1,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: "insert", line: afterLines[j - 1]!, newIndex: j - 1 });
      j--;
    } else {
      ops.push({ type: "delete", line: beforeLines[i - 1]!, oldIndex: i - 1 });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

function isChangeOp(op: DiffOp): boolean {
  return op.type !== "equal";
}

export function computeDiffHunks(before: string, after: string): DiffHunk[] {
  if (before === after) return [];

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const ops = diffOps(beforeLines, afterLines);

  const changeIndices = ops
    .map((op, idx) => (isChangeOp(op) ? idx : -1))
    .filter((idx) => idx >= 0);

  if (changeIndices.length === 0) return [];

  const groups: number[][] = [];
  let group: number[] = [changeIndices[0]!];

  for (let k = 1; k < changeIndices.length; k++) {
    const prev = changeIndices[k - 1]!;
    const curr = changeIndices[k]!;
    if (curr - prev - 1 <= CONTEXT_LINES) {
      group.push(curr);
    } else {
      groups.push(group);
      group = [curr];
    }
  }
  groups.push(group);

  const hunks: DiffHunk[] = [];

  for (const indices of groups) {
    const first = indices[0]!;
    const last = indices.at(-1)!;

    let rangeStart = first;
    let ctxBefore = 0;
    while (rangeStart > 0 && ctxBefore < CONTEXT_LINES) {
      rangeStart--;
      if (ops[rangeStart]!.type === "equal") ctxBefore++;
      else break;
    }

    let rangeEnd = last;
    let ctxAfter = 0;
    while (rangeEnd < ops.length - 1 && ctxAfter < CONTEXT_LINES) {
      rangeEnd++;
      if (ops[rangeEnd]!.type === "equal") ctxAfter++;
      else break;
    }

    const contextBefore: string[] = [];
    const removed: string[] = [];
    const added: string[] = [];
    const contextAfter: string[] = [];
    let oldStart = -1;
    let seenChange = false;

    for (let idx = rangeStart; idx <= rangeEnd; idx++) {
      const op = ops[idx]!;
      if (op.type === "equal") {
        if (!seenChange) contextBefore.push(op.line);
        else contextAfter.push(op.line);
      } else if (op.type === "delete") {
        seenChange = true;
        if (oldStart < 0) oldStart = op.oldIndex;
        removed.push(op.line);
      } else {
        seenChange = true;
        if (oldStart < 0) {
          const prevEqual = ops
            .slice(0, idx)
            .reverse()
            .find((o) => o.type === "equal");
          oldStart =
            prevEqual?.type === "equal" ? prevEqual.oldIndex + 1 : 0;
        }
        added.push(op.line);
      }
    }

    hunks.push({
      oldStart: Math.max(0, oldStart),
      removed,
      added,
      contextBefore,
      contextAfter,
    });
  }

  return hunks;
}

export function applyHunks(
  original: string,
  hunks: DiffHunk[],
  acceptedIndices: Set<number>,
): string {
  const lines = original.split("\n");
  const sorted = [...acceptedIndices].sort((a, b) => a - b);
  let offset = 0;

  for (const hunkIndex of sorted) {
    const hunk = hunks[hunkIndex];
    if (!hunk) continue;

    const start = hunk.oldStart + offset;
    lines.splice(start, hunk.removed.length, ...hunk.added);
    offset += hunk.added.length - hunk.removed.length;
  }

  return lines.join("\n");
}

export function formatHunkHeader(
  hunk: DiffHunk,
  index: number,
  total: number,
  filePath: string,
): string {
  const oldSpan =
    hunk.contextBefore.length + hunk.removed.length + hunk.contextAfter.length;
  const newSpan =
    hunk.contextBefore.length + hunk.added.length + hunk.contextAfter.length;
  return `--- ${filePath}\n+++ ${filePath}\n@@ -${hunk.oldStart + 1},${Math.max(oldSpan, 1)} +${hunk.oldStart + 1},${Math.max(newSpan, 1)} @@ (${index + 1}/${total})`;
}

export function formatHunkBody(hunk: DiffHunk): string {
  const lines: string[] = [];
  for (const line of hunk.contextBefore) lines.push(` ${line}`);
  for (const line of hunk.removed) lines.push(`-${line}`);
  for (const line of hunk.added) lines.push(`+${line}`);
  for (const line of hunk.contextAfter) lines.push(` ${line}`);
  return lines.join("\n");
}

export function hunkPatchLines(hunk: DiffHunk): string[] {
  return formatHunkBody(hunk).split("\n");
}

export function canSplitHunk(hunk: DiffHunk): boolean {
  const changeLines =
    hunk.removed.length + hunk.added.length;
  if (changeLines < 2) return false;

  const lines = hunkPatchLines(hunk);
  let seenChange = false;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    if (line.startsWith("+") || line.startsWith("-")) seenChange = true;
    if (seenChange && line.startsWith(" ")) {
      const hasMore = lines
        .slice(i + 1)
        .some((l) => l.startsWith("+") || l.startsWith("-"));
      if (hasMore) return true;
    }
  }

  return changeLines >= 2;
}

function patchLinesToHunk(
  base: DiffHunk,
  lines: string[],
  oldStart: number,
): DiffHunk {
  const contextBefore: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  const contextAfter: string[] = [];
  let phase: "before" | "change" | "after" = "before";

  for (const raw of lines) {
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

  return {
    oldStart,
    removed,
    added,
    contextBefore,
    contextAfter,
  };
}

export function splitHunk(hunk: DiffHunk): [DiffHunk, DiffHunk] | null {
  if (!canSplitHunk(hunk)) return null;

  const lines = hunkPatchLines(hunk);
  let seenChange = false;

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    if (line.startsWith("+") || line.startsWith("-")) seenChange = true;
    if (seenChange && line.startsWith(" ")) {
      const hasMore = lines
        .slice(i + 1)
        .some((l) => l.startsWith("+") || l.startsWith("-"));
      if (hasMore) {
        const firstLines = lines.slice(0, i + 1);
        const secondLines = lines.slice(i);
        const first = patchLinesToHunk(hunk, firstLines, hunk.oldStart);
        const removedInFirst = first.removed.length;
        const second = patchLinesToHunk(
          hunk,
          secondLines,
          hunk.oldStart + removedInFirst,
        );
        return [first, second];
      }
    }
  }

  if (hunk.removed.length >= 2) {
    const mid = Math.floor(hunk.removed.length / 2);
    return [
      {
        ...hunk,
        removed: hunk.removed.slice(0, mid),
        added: hunk.added.slice(0, Math.min(hunk.added.length, mid)),
        contextAfter: [],
      },
      {
        oldStart: hunk.oldStart + mid,
        removed: hunk.removed.slice(mid),
        added: hunk.added.slice(Math.min(hunk.added.length, mid)),
        contextBefore: [...hunk.contextBefore, ...hunk.removed.slice(0, mid)],
        contextAfter: hunk.contextAfter,
      },
    ];
  }

  if (hunk.added.length >= 2) {
    const mid = Math.floor(hunk.added.length / 2);
    return [
      {
        ...hunk,
        added: hunk.added.slice(0, mid),
        removed: hunk.removed.slice(0, Math.min(hunk.removed.length, mid)),
        contextAfter: [],
      },
      {
        oldStart: hunk.oldStart + Math.min(hunk.removed.length, mid),
        added: hunk.added.slice(mid),
        removed: hunk.removed.slice(Math.min(hunk.removed.length, mid)),
        contextBefore: hunk.contextBefore,
        contextAfter: hunk.contextAfter,
      },
    ];
  }

  return null;
}

export interface SnapshotRef {
  role?: string;
  name?: string;
}

import type { SnapshotTarget } from "../types/recorder.js";

export type { SnapshotTarget };

export interface ParsedSnapshot {
  origin?: string;
  refs: Record<string, SnapshotRef>;
  snapshotText: string;
}

export function normalizeSnapshotLabel(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseSnapshotJson(stdout: string): ParsedSnapshot | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const jsonStart = trimmed.indexOf("{");
  const jsonSlice = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

  try {
    const payload = JSON.parse(jsonSlice) as {
      success?: boolean;
      data?: {
        origin?: string;
        refs?: Record<string, SnapshotRef>;
        snapshot?: string;
      };
    };
    if (!payload.success || !payload.data) return null;
    const refs = payload.data.refs ?? {};
    const snapshotText = payload.data.snapshot ?? "";
    const mergedRefs = { ...refs, ...parseRefsFromSnapshotText(snapshotText) };
    return {
      origin: payload.data.origin,
      refs: mergedRefs,
      snapshotText,
    };
  } catch {
    return null;
  }
}

export function parseRefsFromSnapshotText(
  text: string,
): Record<string, SnapshotRef> {
  const refs: Record<string, SnapshotRef> = {};
  const lineRe = /@(e\d+)\s+\[([^\]]+)\](?:\s+"([^"]*)")?/g;
  for (const match of text.matchAll(lineRe)) {
    const id = match[1];
    if (!id) continue;
    refs[id] = {
      role: match[2]?.trim(),
      name: match[3]?.trim(),
    };
  }
  return refs;
}

export function formatSnapshotTarget(
  refId: string,
  ref: SnapshotRef,
): SnapshotTarget {
  const role = ref.role?.trim();
  const name = ref.name?.trim();
  const rolePart = role ? `[${role}]` : "";
  const namePart = name ? ` "${name}"` : "";
  const description = `@${refId} ${rolePart}${namePart}`.trim();
  return {
    ref: refId,
    role,
    name,
    description,
  };
}

export interface MatchableInteraction {
  role?: string;
  name?: string;
  label?: string;
}

export function matchEventToSnapshotTarget(
  event: MatchableInteraction,
  parsed: ParsedSnapshot,
): SnapshotTarget | undefined {
  const entries = Object.entries(parsed.refs);
  if (entries.length === 0) return undefined;

  const eventRole = normalizeSnapshotLabel(event.role);
  const eventName = normalizeSnapshotLabel(event.name || event.label);

  let best: { id: string; ref: SnapshotRef; score: number } | undefined;
  let secondScore = 0;

  for (const [id, ref] of entries) {
    let score = 0;
    const refRole = normalizeSnapshotLabel(ref.role);
    const refName = normalizeSnapshotLabel(ref.name);

    if (eventRole && refRole) {
      if (eventRole === refRole) score += 5;
      else if (refRole.includes(eventRole) || eventRole.includes(refRole)) {
        score += 2;
      } else {
        score -= 6;
      }
    }

    if (eventName && refName) {
      if (eventName === refName) score += 8;
      else if (refName.includes(eventName) || eventName.includes(refName)) {
        score += 4;
      }
    } else if (eventName && !refName && eventRole && refRole === eventRole) {
      score += 1;
    }

    if (score <= 0) continue;

    if (!best || score > best.score) {
      secondScore = best?.score ?? 0;
      best = { id, ref, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (!best || best.score < 5) return undefined;
  if (best.score - secondScore < 2 && secondScore > 0) return undefined;

  return formatSnapshotTarget(best.id, best.ref);
}

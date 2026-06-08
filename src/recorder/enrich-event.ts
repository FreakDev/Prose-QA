import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildBrowserEnv, runBash } from "../agent/bash.js";
import type { PqaConfig } from "../types/config.js";
import type { RecordEvent } from "../types/recorder.js";
import { appendEvent, readMeta } from "./events.js";
import {
  matchEventToSnapshotTarget,
  parseSnapshotJson,
  type SnapshotTarget,
} from "./snapshot-match.js";

const SNAPSHOT_EVENT_TYPES = new Set([
  "click",
  "fill",
  "select",
  "submit",
  "navigate",
]);

let enrichChain: Promise<void> = Promise.resolve();

function needsSnapshot(event: RecordEvent): boolean {
  return SNAPSHOT_EVENT_TYPES.has(event.type);
}

export async function captureInteractiveSnapshot(options: {
  cwd: string;
  recordingDir: string;
  sessionName: string;
  headed: boolean;
  timeoutMs: number;
  eventTs: number;
}): Promise<{ parsed: ReturnType<typeof parseSnapshotJson>; path?: string }> {
  const env = buildBrowserEnv({
    headed: options.headed,
    sessionName: options.sessionName,
    artifactDir: options.recordingDir,
  });

  const entry = await runBash("agent-browser snapshot --json", {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });

  const combined = `${entry.stdout}\n${entry.stderr}`.trim();
  const parsed = parseSnapshotJson(combined);
  if (!parsed) return { parsed: null };

  const snapDir = path.join(options.recordingDir, "snapshots");
  const snapPath = path.join(snapDir, `${options.eventTs}.json`);
  writeFileSync(
    snapPath,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), ...parsed }, null, 2)}\n`,
    "utf-8",
  );

  return { parsed, path: snapPath };
}

export function applySnapshotTarget<T extends RecordEvent>(
  event: T,
  target: SnapshotTarget | undefined,
): T {
  if (!target) return event;
  return {
    ...event,
    snapshot: target,
    role: target.role ?? ("role" in event ? event.role : undefined),
    name: target.name ?? ("name" in event ? event.name : undefined),
    ...("label" in event && target.name
      ? { label: target.name }
      : {}),
  } as T;
}

export async function enrichRecordEvent(options: {
  cwd: string;
  recordingDir: string;
  config: PqaConfig;
  event: RecordEvent;
}): Promise<RecordEvent> {
  if (!needsSnapshot(options.event)) return options.event;

  const meta = readMeta(options.recordingDir);
  const { parsed } = await captureInteractiveSnapshot({
    cwd: options.cwd,
    recordingDir: options.recordingDir,
    sessionName: meta.sessionName,
    headed: true,
    timeoutMs: options.config.agent.bashTimeoutMs,
    eventTs: options.event.ts,
  });

  if (!parsed) return options.event;

  const event = options.event;
  if (event.type !== "click" && event.type !== "fill" && event.type !== "select") {
    return options.event;
  }

  const target = matchEventToSnapshotTarget(event, parsed);
  return applySnapshotTarget(event, target);
}

export function enqueueEnrichedAppend(options: {
  cwd: string;
  recordingDir: string;
  config: PqaConfig;
  event: RecordEvent;
  sensitiveEnvVars: string[];
}): void {
  enrichChain = enrichChain
    .then(async () => {
      const enriched = await enrichRecordEvent({
        cwd: options.cwd,
        recordingDir: options.recordingDir,
        config: options.config,
        event: options.event,
      });
      appendEvent(options.recordingDir, enriched, options.sensitiveEnvVars);
    })
    .catch(() => {
      appendEvent(options.recordingDir, options.event, options.sensitiveEnvVars);
    });
}

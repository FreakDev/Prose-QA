import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { RecordingMeta, RecordEvent } from "../types/recorder.js";
import { sanitizeRecordEvent } from "./redact.js";

export function recordingDir(cwd: string, outputDir: string, id: string): string {
  return path.join(cwd, outputDir, id);
}

export function eventsPath(dir: string): string {
  return path.join(dir, "events.jsonl");
}

export function metaPath(dir: string): string {
  return path.join(dir, "meta.json");
}

export function appendEvent(
  dir: string,
  event: RecordEvent,
  sensitiveEnvVars: string[] = [],
): void {
  const line = `${JSON.stringify(sanitizeRecordEvent(event, sensitiveEnvVars))}\n`;
  appendFileSync(eventsPath(dir), line, "utf-8");
}

export function readEvents(dir: string): RecordEvent[] {
  const file = eventsPath(dir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RecordEvent);
}

export function writeMeta(dir: string, meta: RecordingMeta): void {
  writeFileSync(metaPath(dir), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

export function readMeta(dir: string): RecordingMeta {
  return JSON.parse(readFileSync(metaPath(dir), "utf-8")) as RecordingMeta;
}

export function ensureRecordingDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "snapshots"), { recursive: true });
  if (!existsSync(eventsPath(dir))) {
    writeFileSync(eventsPath(dir), "", "utf-8");
  }
}

export function newRecordingId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

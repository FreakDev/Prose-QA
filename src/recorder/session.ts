import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ActiveRecording } from "../types/recorder.js";
import type { RecorderConfig } from "../types/config.js";

const ACTIVE_FILE = "active.json";

export function resolveRecorderConfig(
  config?: RecorderConfig,
): Required<Pick<RecorderConfig, "bridgePort" | "outputDir" | "defaultTags">> {
  return {
    bridgePort: config?.bridgePort ?? 17_321,
    outputDir: config?.outputDir ?? ".pqa/recordings",
    defaultTags: config?.defaultTags ?? ["recorded"],
  };
}

export function activeRecordingPath(cwd: string, outputDir: string): string {
  return path.join(cwd, outputDir, ACTIVE_FILE);
}

export function readActiveRecording(
  cwd: string,
  outputDir: string,
): ActiveRecording | undefined {
  const file = activeRecordingPath(cwd, outputDir);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf-8")) as ActiveRecording;
}

export function writeActiveRecording(
  cwd: string,
  outputDir: string,
  active: ActiveRecording,
): void {
  writeFileSync(
    activeRecordingPath(cwd, outputDir),
    `${JSON.stringify(active, null, 2)}\n`,
    "utf-8",
  );
}

export function clearActiveRecording(cwd: string, outputDir: string): void {
  const file = activeRecordingPath(cwd, outputDir);
  if (existsSync(file)) unlinkSync(file);
}

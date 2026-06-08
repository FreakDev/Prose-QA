import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { ArtifactsMode } from "../types/config.js";
import type { ScenarioResult } from "../types/verdict.js";

/** Browser failure captures written by the agent under $PQA_ARTIFACT_DIR */
export const BROWSER_ARTIFACT_FILES = ["failure.png", "snapshot.json"] as const;

export function formatArtifactsRuntimeHint(mode: ArtifactsMode): string {
  switch (mode) {
    case "never":
      return [
        "Browser failure artifacts: disabled.",
        "Do NOT write failure.png or snapshot.json under $PQA_ARTIFACT_DIR.",
      ].join("\n");
    case "always":
      return [
        "Browser failure artifacts: always.",
        "After verifying all Then checkpoints (pass or fail), capture to $PQA_ARTIFACT_DIR:",
        '  agent-browser screenshot "$PQA_ARTIFACT_DIR/failure.png"',
        '  agent-browser snapshot -i --json > "$PQA_ARTIFACT_DIR/snapshot.json"',
      ].join("\n");
    default:
      return [
        "Browser failure artifacts: on failure only.",
        "If any Then checkpoint fails, capture to $PQA_ARTIFACT_DIR:",
        '  agent-browser screenshot "$PQA_ARTIFACT_DIR/failure.png"',
        '  agent-browser snapshot -i --json > "$PQA_ARTIFACT_DIR/snapshot.json"',
      ].join("\n");
  }
}

export function pruneBrowserArtifacts(artifactDir: string): void {
  for (const name of BROWSER_ARTIFACT_FILES) {
    const filePath = path.join(artifactDir, name);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/** Enforce --artifacts policy after a scenario (harness transcripts are unaffected). */
export function applyArtifactsPolicy(
  artifactDir: string,
  mode: ArtifactsMode,
  result: Pick<ScenarioResult, "status">,
): void {
  if (mode === "never") {
    pruneBrowserArtifacts(artifactDir);
    return;
  }
  if (mode === "on-failure" && result.status === "pass") {
    pruneBrowserArtifacts(artifactDir);
  }
}

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ensureRunDir } from "./index.js";

export interface ReportOutputOptions {
  outputPath?: string;
  zip: boolean;
}

export interface ResolvedRunDirectory {
  runDir: string;
  /** Set when the run must be archived to zip after completion. */
  zipDestination?: string;
}

function isDirectoryBasePath(outputPath: string): boolean {
  return outputPath.endsWith("/") || outputPath.endsWith("\\");
}

export function resolveReportOutputDestination(
  outputPath: string,
  runId: string,
  zip: boolean,
  cwd: string,
): string {
  const directoryBase = isDirectoryBasePath(outputPath);
  const resolved = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(cwd, outputPath);

  if (directoryBase) {
    const parentDir = resolved.replace(/[/\\]+$/, "");
    return zip
      ? path.join(parentDir, `${runId}.zip`)
      : path.join(parentDir, runId);
  }

  return resolved;
}

export function resolveRunDirectory(
  cwd: string,
  runId: string,
  options: ReportOutputOptions,
): ResolvedRunDirectory {
  if (!options.outputPath) {
    return { runDir: ensureRunDir(cwd, runId) };
  }

  const destination = resolveReportOutputDestination(
    options.outputPath,
    runId,
    options.zip,
    cwd,
  );

  if (options.zip) {
    return {
      runDir: ensureRunDir(cwd, runId),
      zipDestination: destination,
    };
  }

  mkdirSync(destination, { recursive: true });
  return { runDir: destination };
}

export function exportRunReportZip(
  runDir: string,
  zipDestination: string,
): void {
  mkdirSync(path.dirname(zipDestination), { recursive: true });
  if (existsSync(zipDestination)) {
    rmSync(zipDestination);
  }

  const result = spawnSync(
    "tar",
    ["-a", "-cf", zipDestination, "-C", runDir, "."],
    { encoding: "utf-8" },
  );

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
    throw new Error(
      `Failed to create report zip at ${zipDestination}: ${detail}`,
    );
  }
}

export function finalizeRunReport(
  runDir: string,
  zipDestination?: string,
): string {
  if (zipDestination) {
    exportRunReportZip(runDir, zipDestination);
    return zipDestination;
  }
  return path.join(runDir, "report.html");
}

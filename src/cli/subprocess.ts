import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { RunOptions } from "../types/config.js";
import type { ScenarioResult } from "../types/verdict.js";
import { scenarioArtifactDir } from "../reporter/index.js";
import { killProcessTree } from "../process-tree.js";

const activeWorkers = new Set<ChildProcess>();
const heartbeatWatchdogs = new Map<number, NodeJS.Timeout>();
const heartbeatFilePaths = new Map<number, string>();
let shutdownHandlersInstalled = false;

function installParallelShutdownHandlers(): void {
  if (shutdownHandlersInstalled) return;
  shutdownHandlersInstalled = true;

  const onSignal = (signal: NodeJS.Signals) => {
    killAllScenarioWorkers(signal);
    process.exit(signal === "SIGINT" ? 130 : 128 + 15);
  };

  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
}

export function trackScenarioWorker(child: ChildProcess): void {
  activeWorkers.add(child);
  const untrack = () => activeWorkers.delete(child);
  child.once("close", untrack);
  child.once("error", untrack);
}

/** Terminate all scenario worker subprocesses (parallel mode). */
export function killAllScenarioWorkers(
  signal: NodeJS.Signals = "SIGTERM",
): void {
  const effectiveSignal = signal === "SIGINT" ? "SIGKILL" : signal;
  for (const child of activeWorkers) {
    if (child.killed || child.exitCode !== null) continue;
    killProcessTree(child.pid, effectiveSignal);
  }

  // Clean up heartbeat files for all tracked workers
  // (the child.on("close") handler won't fire because process.exit() runs right after)
  for (const [, filePath] of heartbeatFilePaths) {
    try {
      unlinkSync(filePath);
    } catch {
      /* ENOENT */
    }
  }
  heartbeatFilePaths.clear();
}

export function resolveCliInvocation(): {
  command: string;
  baseArgs: string[];
} {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error("Cannot resolve CLI entry point");
  }
  if (entry.endsWith(".ts")) {
    return {
      command: process.execPath,
      baseArgs: ["--import", "tsx", entry],
    };
  }
  return {
    command: process.execPath,
    baseArgs: [entry],
  };
}

export interface ScenarioWorkerRequest {
  scenarioFilePath: string;
  scenarioName: string;
  runDir: string;
  cwd: string;
  options: Omit<RunOptions, "parallel" | "pause" | "failFast">;
}

function buildWorkerArgs(request: ScenarioWorkerRequest): string[] {
  const { command: _cmd, baseArgs } = resolveCliInvocation();
  const { options } = request;
  const args = [
    ...baseArgs,
    "_run-scenario",
    "--run-dir",
    request.runDir,
    "--scenario",
    request.scenarioFilePath,
  ];

  if (options.configPath) {
    args.push("--config", options.configPath);
  }
  if (options.skillsDirs?.length) {
    args.push("--skills-dir", options.skillsDirs.join(","));
  }
  if (options.retries !== undefined) {
    args.push("--retries", String(options.retries));
  }
  if (options.retriesPolicy) {
    args.push("--retries-policy", options.retriesPolicy);
  }
  if (options.noHealing) {
    args.push("--no-healing");
  }
  if (options.noCache) {
    args.push("--no-cache");
  }
  if (options.artifacts) {
    args.push("--artifacts", options.artifacts);
  }
  if (options.headed) {
    args.push("--headed");
  }
  if (options.actionOverlay) {
    args.push("--action-overlay");
  }
  if (options.verbose) {
    args.push("--verbose");
  }
  if (options.keepBrowser) {
    args.push("--keep-browser");
  }
  if (options.authRefresh) {
    args.push("--auth-refresh");
  }
  if (options.skipPreBatch) {
    args.push("--skip-pre-batch");
  }

  return args;
}

function readWorkerResult(
  runDir: string,
  scenarioName: string,
): ScenarioResult {
  const artifactDir = scenarioArtifactDir(runDir, scenarioName);
  const resultPath = path.join(artifactDir, "result.json");
  const raw = readFileSync(resultPath, "utf-8");
  return JSON.parse(raw) as ScenarioResult;
}

export async function spawnScenarioWorker(
  request: ScenarioWorkerRequest,
): Promise<ScenarioResult> {
  const { command, baseArgs: _baseArgs } = resolveCliInvocation();
  const args = buildWorkerArgs(request);
  const name = request.scenarioName;

  installParallelShutdownHandlers();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: request.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group so kill(-pid) tears down bash grandchildren too.
      detached: process.platform !== "win32",
    });

    trackScenarioWorker(child);

    // Start heartbeat watchdog
    const heartbeatFile = path.join(
      request.runDir,
      ".heartbeat-" + String(child.pid),
    );
    const workerStartedAt = Date.now();
    const inactivityTimeoutMs =
      request.options.workerInactivityTimeoutMs ?? 120_000;
    const checkIntervalMs =
      request.options.workerHeartbeatIntervalMs ?? 15_000;
    const watchTimer = setInterval(() => {
      if (child.killed || child.exitCode !== null) {
        clearInterval(watchTimer);
        heartbeatWatchdogs.delete(child.pid!);
        return;
      }
      try {
        const content = readFileSync(heartbeatFile, "utf-8");
        const lastHeartbeat = Number(content);
        if (!Number.isFinite(lastHeartbeat)) return;
        // Ignore stale files left by a prior worker that reused this PID.
        if (lastHeartbeat < workerStartedAt) return;
        if (Date.now() - lastHeartbeat > inactivityTimeoutMs) {
          console.error(
            `[${name}] worker heartbeat expired, killing (SIGKILL)`,
          );
          killProcessTree(child.pid, "SIGKILL");
          clearInterval(watchTimer);
          heartbeatWatchdogs.delete(child.pid!);
        }
      } catch {
        // Heartbeat file not yet written — worker still starting
      }
    }, checkIntervalMs);
    heartbeatWatchdogs.set(child.pid!, watchTimer);
    heartbeatFilePaths.set(child.pid!, heartbeatFile);

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) process.stderr.write(`[${name}] ${line}\n`);
      }
    });

    child.on("error", (err) => {
      // Clean up heartbeat watchdog
      const timer = heartbeatWatchdogs.get(child.pid!);
      if (timer) {
        clearInterval(timer);
        heartbeatWatchdogs.delete(child.pid!);
      }
      heartbeatFilePaths.delete(child.pid!);
      try {
        unlinkSync(heartbeatFile);
      } catch {
        /* ENOENT */
      }
      reject(err);
    });

    child.on("close", (code) => {
      // Clean up heartbeat watchdog
      const timer = heartbeatWatchdogs.get(child.pid!);
      if (timer) {
        clearInterval(timer);
        heartbeatWatchdogs.delete(child.pid!);
      }
      heartbeatFilePaths.delete(child.pid!);
      try {
        unlinkSync(heartbeatFile);
      } catch {
        /* ENOENT */
      }
      try {
        const result = readWorkerResult(request.runDir, name);
        resolve(result);
      } catch (err) {
        reject(
          new Error(
            `Worker for "${name}" exited with code ${code ?? "unknown"} ` +
              `but no result.json was written: ${String(err)}`,
          ),
        );
      }
    });
  });
}

/**
 * Delete a heartbeat file for a given runDir and PID.
 * Silently ignores ENOENT.
 */
export function cleanupHeartbeatFile(runDir: string, pid: number): void {
  const filePath = path.join(runDir, ".heartbeat-" + String(pid));
  try {
    unlinkSync(filePath);
  } catch {
    /* ENOENT */
  }
}

/**
 * Sweep a run directory and remove all leftover .heartbeat-* files.
 * Safe to call at the end of a run as a safety net.
 */
export function cleanupRunDirHeartbeats(runDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(runDir);
  } catch {
    return; // runDir doesn't exist
  }
  for (const entry of entries) {
    if (entry.startsWith(".heartbeat-")) {
      try {
        unlinkSync(path.join(runDir, entry));
      } catch {
        /* ENOENT / race */
      }
    }
  }
}


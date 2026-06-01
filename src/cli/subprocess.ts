import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RunOptions } from "../types/config.js";
import type { ScenarioResult } from "../types/verdict.js";
import { scenarioArtifactDir } from "../reporter/index.js";

const activeWorkers = new Set<ChildProcess>();
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
  for (const child of activeWorkers) {
    if (child.killed || child.exitCode !== null) continue;
    try {
      child.kill(signal);
    } catch {
      /* already stopped */
    }
  }
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
  if (options.artifacts) {
    args.push("--artifacts", options.artifacts);
  }
  if (options.headed) {
    args.push("--headed");
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
    });

    trackScenarioWorker(child);

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

    child.on("error", reject);

    child.on("close", (code) => {
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

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveBridgeWorkerScript(projectRoot: string): string {
  const built = path.join(projectRoot, "dist/recorder/bridge-worker.js");
  if (existsSync(built)) return built;
  return path.join(projectRoot, "src/recorder/bridge-worker.ts");
}

function bridgeWorkerSpawn(
  projectRoot: string,
  script: string,
  args: string[],
): ReturnType<typeof spawn> {
  if (script.endsWith(".ts")) {
    const tsxBin = path.join(projectRoot, "node_modules/.bin/tsx");
    if (!existsSync(tsxBin)) {
      throw new Error(
        "tsx is required to run the recording bridge (npm install). Run `npm run build` for production.",
      );
    }
    return spawn(tsxBin, [script, ...args], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readBridgeUrlFromStdout(
  child: ReturnType<typeof spawn>,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error("Recording bridge did not print its URL"));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const line = buffer
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("http://"));
      if (line) {
        clearTimeout(timer);
        resolve(line);
      }
    });
  });
}

async function waitForBridgeHealth(
  url: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Recording bridge did not become ready at ${url}`);
}

export interface SpawnedBridge {
  pid: number;
  url: string;
}

export async function spawnRecordingBridgeWorker(options: {
  projectRoot: string;
  recordingDir: string;
  port: number;
  configPath?: string;
}): Promise<SpawnedBridge> {
  const script = resolveBridgeWorkerScript(options.projectRoot);
  const args = [
    "--dir",
    options.recordingDir,
    "--port",
    String(options.port),
    "--cwd",
    options.projectRoot,
  ];
  if (options.configPath) {
    args.push("--config", options.configPath);
  }

  const child = bridgeWorkerSpawn(options.projectRoot, script, args);
  const fallbackUrl = `http://127.0.0.1:${options.port}`;

  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(
          new Error(
            `Recording bridge exited with code ${code}: ${stderr.trim()}`,
          ),
        );
      }
    });

    void (async () => {
      try {
        const bridgeUrl = await readBridgeUrlFromStdout(child);
        await waitForBridgeHealth(bridgeUrl);
        const pid = child.pid;
        if (!pid) {
          reject(new Error("Recording bridge process has no PID"));
          return;
        }
        child.unref();
        resolve({ pid, url: bridgeUrl });
      } catch (err) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        reject(
          err instanceof Error
            ? err
            : new Error(`Recording bridge failed: ${stderr || fallbackUrl}`),
        );
      }
    })();
  });
}

export function stopRecordingBridgeWorker(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already stopped */
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import {
  cleanupHeartbeatFile,
  cleanupRunDirHeartbeats,
  killAllScenarioWorkers,
  resolveCliInvocation,
  trackScenarioWorker,
} from "./subprocess.js";

function tmpDir(): string {
  const dir = path.join(
    process.cwd(),
    ".pqa-test-tmp",
    "subprocess-" + String(Math.random()).slice(2, 10),
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Helper: start a watchdog interval that mirrors the logic inside spawnScenarioWorker.
 * Returns the pid + timer so the caller can control cleanup.
 */
function startWatchdog(
  child: ChildProcess,
  heartbeatFile: string,
  inactivityTimeoutMs: number,
  checkIntervalMs: number,
  workerStartedAt: number,
  onKill?: () => void,
): { pid: number; timer: NodeJS.Timeout } {
  const pid = child.pid!;
  const timer = setInterval(() => {
    if (child.killed || child.exitCode !== null) {
      clearInterval(timer);
      return;
    }
    try {
      const content = readFileSync(heartbeatFile, "utf-8");
      const lastHeartbeat = Number(content);
      if (!Number.isFinite(lastHeartbeat)) return;
      if (lastHeartbeat < workerStartedAt) return;
      if (Date.now() - lastHeartbeat > inactivityTimeoutMs) {
        child.kill("SIGKILL");
        clearInterval(timer);
        onKill?.();
      }
    } catch {
      // file not yet written
    }
  }, checkIntervalMs);
  return { pid, timer };
}

async function waitForHeartbeatFile(
  heartbeatFile: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      readFileSync(heartbeatFile, "utf-8");
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`heartbeat file was not created: ${heartbeatFile}`);
}

describe("killAllScenarioWorkers", () => {
  it("terminates a real child process on SIGINT (SIGKILL tree)", async () => {
    if (process.platform === "win32") return;

    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1_000_000)"],
      { detached: true },
    );
    trackScenarioWorker(child);
    killAllScenarioWorkers("SIGINT");

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child did not exit")), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });

  it("terminates a real child process", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1_000_000)",
    ]);
    trackScenarioWorker(child);
    killAllScenarioWorkers("SIGTERM");

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child did not exit")), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});

describe("resolveCliInvocation", () => {
  it("returns node + script path for compiled CLI", () => {
    const original = process.argv[1];
    process.argv[1] = "/project/dist/cli/index.js";
    try {
      const inv = resolveCliInvocation();
      assert.equal(inv.command, process.execPath);
      assert.deepEqual(inv.baseArgs, ["/project/dist/cli/index.js"]);
    } finally {
      if (original !== undefined) {
        process.argv[1] = original;
      }
    }
  });

  it("uses tsx loader for TypeScript CLI entry", () => {
    const original = process.argv[1];
    process.argv[1] = "/project/src/cli/index.ts";
    try {
      const inv = resolveCliInvocation();
      assert.equal(inv.command, process.execPath);
      assert.deepEqual(inv.baseArgs, [
        "--import",
        "tsx",
        "/project/src/cli/index.ts",
      ]);
    } finally {
      if (original !== undefined) {
        process.argv[1] = original;
      }
    }
  });
});

describe("cleanupRunDirHeartbeats", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("deletes all .heartbeat-* files in a runDir", () => {
    const dir = tmpDir();
    dirs.push(dir);
    writeFileSync(path.join(dir, ".heartbeat-111"), "stale");
    writeFileSync(path.join(dir, ".heartbeat-222"), "stale");
    writeFileSync(path.join(dir, "result.json"), "keep");

    cleanupRunDirHeartbeats(dir);

    assert.equal(existsSync(path.join(dir, ".heartbeat-111")), false);
    assert.equal(existsSync(path.join(dir, ".heartbeat-222")), false);
    assert.equal(existsSync(path.join(dir, "result.json")), true);
  });

  it("does not throw when runDir is missing", () => {
    cleanupRunDirHeartbeats("/tmp/nonexistent-dir-" + Math.random());
    // no assertion needed
  });
});

describe("cleanupHeartbeatFile", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("deletes an existing heartbeat file", () => {
    const dir = tmpDir();
    dirs.push(dir);
    const pid = 99999;
    const filePath = path.join(dir, ".heartbeat-" + String(pid));
    writeFileSync(filePath, String(Date.now()));
    assert.equal(existsSync(filePath), true);
    cleanupHeartbeatFile(dir, pid);
    assert.equal(existsSync(filePath), false);
  });

  it("does not throw when heartbeat file is missing", () => {
    const dir = tmpDir();
    dirs.push(dir);
    cleanupHeartbeatFile(dir, 88888);
    // no assertion needed — just verifying no throw
  });
});

describe("heartbeat watchdog (integration)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("kills a worker whose heartbeat expires", async () => {
    const dir = tmpDir();
    dirs.push(dir);

    // Spawn a child that does nothing (no heartbeat writes)
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1_000_000)",
    ]);

    const workerStartedAt = Date.now();
    const heartbeatFile = path.join(dir, ".heartbeat-" + String(child.pid));

    // Simulate a worker that wrote once at start then hung (post-start, but expired).
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    writeFileSync(heartbeatFile, String(workerStartedAt));

    let killed = false;
    const { timer } = startWatchdog(
      child,
      heartbeatFile,
      100, // very short inactivity timeout
      50, // check every 50ms
      workerStartedAt,
      () => {
        killed = true;
      },
    );

    // Wait for watchdog to kill the child
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Child was not killed by watchdog")),
        5000,
      );
      child.once("exit", () => {
        clearTimeout(timeout);
        clearInterval(timer);
        resolve();
      });
    });

    assert.equal(killed, true, "watchdog should have triggered kill");
    assert.equal(child.signalCode, "SIGKILL");
  });

  it("does not kill a worker that writes heartbeat regularly", async () => {
    const dir = tmpDir();
    dirs.push(dir);

    // Spawn a child that writes the heartbeat file every 50 ms.
    // The file path uses the child's own PID (just like run.ts does).
    const child = spawn(process.execPath, [
      "-e",
      `
const fs = require("fs");
const pid = process.pid;
const hb = ${JSON.stringify(dir)} + "/.heartbeat-" + pid;
fs.writeFileSync(hb, String(Date.now()));
setInterval(() => fs.writeFileSync(hb, String(Date.now())), 50);
setInterval(() => {}, 1_000_000);
      `.trim(),
    ]);

    const heartbeatFile = path.join(dir, ".heartbeat-" + String(child.pid));
    await waitForHeartbeatFile(heartbeatFile);

    const workerStartedAt = Date.now();
    let killed = false;
    const { timer } = startWatchdog(
      child,
      heartbeatFile,
      500, // generous inactivity timeout for loaded CI hosts
      100, // check every 100ms
      workerStartedAt,
      () => {
        killed = true;
      },
    );

    // Let the child run for ~1s — it should survive
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    clearInterval(timer);
    cleanupHeartbeatFile(dir, child.pid!);
    child.kill("SIGTERM");

    // Wait for the child to exit (or resolve immediately if already gone)
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);

    assert.equal(
      killed,
      false,
      "watchdog should NOT have killed a worker writing heartbeats",
    );
  });
});


import { spawnSync } from "node:child_process";

/**
 * Kill a process and its descendants.
 * On Unix, uses the process group (negative PID) when the child was spawned detached.
 */
export function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (!pid || pid <= 0) return;

  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      /* already stopped */
    }
    return;
  }

  try {
    process.kill(-pid, signal);
    return;
  } catch {
    /* fall through to direct PID */
  }

  try {
    process.kill(pid, signal);
  } catch {
    /* already stopped */
  }
}

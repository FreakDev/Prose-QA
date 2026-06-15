import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { killProcessTree } from "../process-tree.js";
import { writeActionOverlayScript } from "../action-overlay/page-script.js";
import {
  lightpandaBrowserEnv,
  resolveLightpandaBinDirs,
} from "../config/lightpanda.js";
import { resolveAgentBrowserBinDirs } from "../paths.js";
import type { BrowserEngine, LightpandaBrowserConfig } from "../types/config.js";
import type { BashEntry } from "../types/verdict.js";

const activeBashChildren = new Set<ChildProcess>();

/** Kill every in-flight bash shell (e.g. on Ctrl+C while runBash is blocked). */
export function killAllBashProcesses(
  signal: NodeJS.Signals = "SIGKILL",
): void {
  for (const child of activeBashChildren) {
    if (child.killed || child.exitCode !== null) continue;
    killProcessTree(child.pid, signal);
  }
}

function prependPathDirs(
  env: NodeJS.ProcessEnv,
  binDirs: string[],
): NodeJS.ProcessEnv {
  if (binDirs.length === 0) return env;

  const existing = env.PATH ?? env.Path ?? process.env.PATH ?? "";
  const nextPath = existing
    ? `${binDirs.join(path.delimiter)}${path.delimiter}${existing}`
    : binDirs.join(path.delimiter);

  return { ...env, PATH: nextPath, Path: nextPath };
}

/** Prepend local agent-browser and Lightpanda dirs so bash works without a global install. */
export function withAgentBrowserPath(
  cwd: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const binDirs = resolveAgentBrowserBinDirs(cwd);
  const seen = new Set(binDirs.map((d) => path.resolve(d)));

  const add = (dir: string) => {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    binDirs.push(resolved);
  };

  if (env.AGENT_BROWSER_EXECUTABLE_PATH) {
    add(path.dirname(env.AGENT_BROWSER_EXECUTABLE_PATH));
  } else {
    for (const dir of resolveLightpandaBinDirs(cwd)) {
      add(dir);
    }
  }

  return prependPathDirs(env, binDirs);
}

function runBashSpawn(
  command: string,
  options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    abortSignal?: AbortSignal;
  },
): Promise<BashEntry> {
  const start = Date.now();
  const env = withAgentBrowserPath(options.cwd, {
    ...process.env,
    ...options.env,
  });

  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", command], {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    activeBashChildren.add(child);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortListener && options.abortSignal) {
        options.abortSignal.removeEventListener("abort", abortListener);
      }
      activeBashChildren.delete(child);
      resolve({
        command,
        stdout,
        stderr: timedOut ? "Command timed out" : stderr,
        exitCode,
        durationMs: Date.now() - start,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid, "SIGKILL");
    }, options.timeoutMs);

    const abortListener = () => {
      if (timedOut || settled) return;
      stderr = stderr || "Aborted";
      killProcessTree(child.pid, "SIGKILL");
    };
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        abortListener();
      } else {
        options.abortSignal.addEventListener("abort", abortListener, {
          once: true,
        });
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (!timedOut) {
        stderr = stderr || String(err);
      }
      finish(1);
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finish(1);
        return;
      }
      if (signal === "SIGKILL" || signal === "SIGTERM") {
        finish(options.abortSignal?.aborted ? 130 : 128 + (signal === "SIGKILL" ? 9 : 15));
        return;
      }
      finish(code ?? 1);
    });
  });
}

export async function runBash(
  command: string,
  options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    abortSignal?: AbortSignal;
  },
): Promise<BashEntry> {
  return runBashSpawn(command, options);
}

export async function closeBrowserSession(options: {
  cwd: string;
  timeoutMs: number;
  sessionName: string;
  headed: boolean;
  engine: BrowserEngine;
  lightpanda?: LightpandaBrowserConfig;
  verbose?: boolean;
}): Promise<void> {
  const env = buildBrowserEnv({
    cwd: options.cwd,
    headed: options.headed,
    sessionName: options.sessionName,
    engine: options.engine,
    lightpanda: options.lightpanda,
    artifactDir: options.cwd,
  });
  const entry = await runBash("agent-browser close 2>/dev/null || true", {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });
  if (options.verbose && (entry.stderr || entry.stdout)) {
    console.error(entry.stderr || entry.stdout);
  }
}

export async function closeAllBrowserSessions(options: {
  cwd: string;
  timeoutMs: number;
  headed: boolean;
  engine: BrowserEngine;
  lightpanda?: LightpandaBrowserConfig;
  verbose?: boolean;
}): Promise<void> {
  const env = buildBrowserEnv({
    cwd: options.cwd,
    headed: options.headed,
    sessionName: "pqa",
    engine: options.engine,
    lightpanda: options.lightpanda,
    artifactDir: options.cwd,
  });
  const entry = await runBash("agent-browser close --all 2>/dev/null || true", {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });
  if (options.verbose && (entry.stderr || entry.stdout)) {
    console.error(entry.stderr || entry.stdout);
  }
}

function stateWasIgnored(entry: BashEntry): boolean {
  const msg = `${entry.stderr}\n${entry.stdout}`;
  return (
    msg.includes("--state ignored") || msg.includes("daemon already running")
  );
}

function isAuthRedirectUrl(url: string): boolean {
  return (
    url.includes("accounts.google.com") || url.includes("iap.googleapis.com")
  );
}

export async function prepareBrowserSession(options: {
  cwd: string;
  timeoutMs: number;
  sessionName: string;
  headed: boolean;
  engine: BrowserEngine;
  lightpanda?: LightpandaBrowserConfig;
  profilePath?: string;
  authStatePath?: string;
  startUrl?: string;
  verbose?: boolean;
  actionOverlay?: boolean;
  overlayBridgeUrl?: string;
}): Promise<{ startUrl: string }> {
  const env = buildBrowserEnv({
    cwd: options.cwd,
    headed: options.headed,
    sessionName: options.sessionName,
    engine: options.engine,
    lightpanda: options.lightpanda,
    profilePath: options.profilePath,
    authStatePath: options.profilePath ? undefined : options.authStatePath,
    artifactDir: options.cwd,
  });
  const startUrl = options.startUrl ?? "about:blank";

  let overlayScriptPath: string | undefined;
  if (options.actionOverlay && options.overlayBridgeUrl) {
    overlayScriptPath = path.join(
      os.tmpdir(),
      `pqa-overlay-${options.sessionName.replace(/[^a-zA-Z0-9_-]/g, "_")}.js`,
    );
    writeActionOverlayScript(overlayScriptPath, {
      bridgeUrl: options.overlayBridgeUrl,
    });
  }

  const initScriptArg = overlayScriptPath
    ? ` --init-script "${overlayScriptPath}"`
    : "";

  await runBash("agent-browser close 2>/dev/null || true", {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });

  let entry = await runBash(
    `agent-browser open${initScriptArg} "${startUrl}"`,
    {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env,
    },
  );

  if (stateWasIgnored(entry)) {
    await runBash("agent-browser close --all 2>/dev/null || true", {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env,
    });
    entry = await runBash(
      `agent-browser open${initScriptArg} "${startUrl}"`,
      {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        env,
      },
    );
  }

  if (entry.exitCode !== 0 || stateWasIgnored(entry)) {
    const label = options.profilePath ? "auth profile" : "browser session";
    throw new Error(
      `Failed to start ${label}: ${entry.stderr || entry.stdout}`,
    );
  }

  if (startUrl !== "about:blank") {
    await runBash("agent-browser wait --load networkidle 2>/dev/null || true", {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env,
    });
  }

  const urlEntry = await runBash("agent-browser get url", {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });
  const currentUrl = urlEntry.stdout.trim();

  if (startUrl !== "about:blank") {
    if (!currentUrl || currentUrl === "about:blank") {
      const hint = options.profilePath ? " Re-run with --auth-refresh." : "";
      throw new Error(
        `Browser is empty after opening ${startUrl} (url=${currentUrl || "(empty)"}).${hint}`,
      );
    }
    if (options.profilePath && isAuthRedirectUrl(currentUrl)) {
      throw new Error(
        `Auth profile is not signed in — browser redirected to ${currentUrl}. Re-run with --auth-refresh.`,
      );
    }
  }

  if (options.verbose) {
    console.log(
      `Browser ready on ${currentUrl || startUrl} (session ${options.sessionName})`,
    );
  }

  return { startUrl: currentUrl || startUrl };
}

export function buildBrowserEnv(config: {
  cwd?: string;
  headed: boolean;
  sessionName: string;
  engine?: BrowserEngine;
  lightpanda?: LightpandaBrowserConfig;
  authStatePath?: string;
  authSavePath?: string;
  profilePath?: string;
  artifactDir: string;
}): NodeJS.ProcessEnv {
  const engine = config.engine ?? "chrome";
  const env: NodeJS.ProcessEnv = {
    PQA_ARTIFACT_DIR: config.artifactDir,
    AGENT_BROWSER_SESSION_NAME: config.sessionName,
    AGENT_BROWSER_SESSION: config.sessionName,
    AGENT_BROWSER_ENGINE: engine,
    ...lightpandaBrowserEnv(config.cwd ?? config.artifactDir, engine, config.lightpanda),
  };
  if (config.profilePath) {
    env.AGENT_BROWSER_PROFILE = config.profilePath;
  } else if (config.authStatePath) {
    env.AGENT_BROWSER_STATE = config.authStatePath;
  }
  if (config.authSavePath) {
    env.PQA_AUTH_SAVE_PATH = config.authSavePath;
  }
  if (!config.headed) {
    env.AGENT_BROWSER_HEADED = "false";
  } else {
    env.AGENT_BROWSER_HEADED = "true";
  }
  return env;
}

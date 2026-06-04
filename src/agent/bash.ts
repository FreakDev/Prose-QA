import { exec } from "node:child_process";
import { promisify } from "node:util";
import { lightpandaBrowserEnv } from "../config/lightpanda.js";
import type { BrowserEngine, LightpandaBrowserConfig } from "../types/config.js";
import type { BashEntry } from "../types/verdict.js";

const execAsync = promisify(exec);

export async function runBash(
  command: string,
  options: {
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  },
): Promise<BashEntry> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: { ...process.env, ...options.env },
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/bash",
    });
    return {
      command,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      killed?: boolean;
    };
    return {
      command,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? (e.killed ? "Command timed out" : String(err)),
      exitCode: typeof e.code === "number" ? e.code : 1,
      durationMs: Date.now() - start,
    };
  }
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
  profilePath: string;
  startUrl?: string;
  verbose?: boolean;
}): Promise<{ startUrl: string }> {
  const env = buildBrowserEnv({
    cwd: options.cwd,
    headed: options.headed,
    sessionName: options.sessionName,
    engine: options.engine,
    lightpanda: options.lightpanda,
    profilePath: options.profilePath,
    artifactDir: options.cwd,
  });
  const startUrl = options.startUrl ?? "about:blank";

  await runBash("agent-browser close 2>/dev/null || true", {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });

  let entry = await runBash(`agent-browser open "${startUrl}"`, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env,
  });

  if (stateWasIgnored(entry)) {
    await runBash("agent-browser close --all 2>/dev/null || true", {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env,
    });
    entry = await runBash(`agent-browser open "${startUrl}"`, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      env,
    });
  }

  if (entry.exitCode !== 0 || stateWasIgnored(entry)) {
    throw new Error(
      `Failed to start browser with auth profile: ${entry.stderr || entry.stdout}`,
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
      throw new Error(
        `Auth profile browser is empty after opening ${startUrl} (url=${currentUrl || "(empty)"}). Re-run with --auth-refresh.`,
      );
    }
    if (isAuthRedirectUrl(currentUrl)) {
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

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
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

export function readFileTool(
  filePath: string,
  cwd: string,
): { content: string } | { error: string } {
  const resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(cwd)) {
    return { error: "Path must stay within project directory" };
  }
  try {
    return { content: readFileSync(resolved, "utf-8") };
  } catch (err) {
    return { error: String(err) };
  }
}

export function buildBrowserEnv(config: {
  headed: boolean;
  sessionName: string;
  authStatePath?: string;
  artifactDir: string;
  baseUrl: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    SAQ_BASE_URL: config.baseUrl,
    SAQ_ARTIFACT_DIR: config.artifactDir,
    AGENT_BROWSER_SESSION_NAME: config.sessionName,
  };
  if (config.authStatePath) {
    env.AGENT_BROWSER_STATE = config.authStatePath;
  }
  if (!config.headed) {
    env.AGENT_BROWSER_HEADED = "false";
  } else {
    env.AGENT_BROWSER_HEADED = "true";
  }
  return env;
}

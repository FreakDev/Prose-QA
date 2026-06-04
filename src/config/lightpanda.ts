import { statSync } from "node:fs";
import path from "node:path";
import type { BrowserEngine, LightpandaBrowserConfig } from "../types/config.js";

const LIGHTPANDA_BINARY =
  process.platform === "win32" ? "lightpanda.exe" : "lightpanda";

/** Resolve executablePath to an absolute binary path (directory → binary inside). */
export function resolveLightpandaExecutablePath(
  cwd: string,
  executablePath: string,
): string {
  const resolved = path.isAbsolute(executablePath)
    ? executablePath
    : path.resolve(cwd, executablePath);

  try {
    if (statSync(resolved).isDirectory()) {
      return path.join(resolved, LIGHTPANDA_BINARY);
    }
  } catch {
    const looksLikeDir =
      executablePath.endsWith("/") ||
      executablePath.endsWith(path.sep) ||
      executablePath === "." ||
      executablePath === "./";
    if (looksLikeDir) {
      return path.join(resolved, LIGHTPANDA_BINARY);
    }
  }

  return resolved;
}

/** Env vars for agent-browser when using the lightpanda engine. */
export function lightpandaBrowserEnv(
  cwd: string,
  engine: BrowserEngine,
  lightpanda?: LightpandaBrowserConfig,
): NodeJS.ProcessEnv {
  if (engine !== "lightpanda" || !lightpanda) return {};

  const env: NodeJS.ProcessEnv = {};

  if (lightpanda.executablePath) {
    env.AGENT_BROWSER_EXECUTABLE_PATH = resolveLightpandaExecutablePath(
      cwd,
      lightpanda.executablePath,
    );
  }

  if (lightpanda.telemetry === false) {
    env.LIGHTPANDA_DISABLE_TELEMETRY = "true";
  }

  return env;
}

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../paths.js";
import type { BrowserEngine, LightpandaBrowserConfig } from "../types/config.js";

const LIGHTPANDA_BINARY =
  process.platform === "win32" ? "lightpanda.exe" : "lightpanda";

/** Default install dir for `pqa install-browser lightpanda` (matches bundled pqa.config). */
export const DEFAULT_LIGHTPANDA_INSTALL_DIR = ".pqa/engine";

function lightpandaBinaryInDir(dir: string): string {
  return path.join(dir, LIGHTPANDA_BINARY);
}

/** Default install locations when no executablePath override is set. */
export function defaultLightpandaSearchDirs(cwd: string): string[] {
  return [
    path.join(cwd, DEFAULT_LIGHTPANDA_INSTALL_DIR),
    path.join(cwd, ".bin"),
    path.join(getPackageRoot(), ".bin"),
  ];
}

/** First existing Lightpanda binary on disk, or undefined. */
export function discoverLightpandaExecutable(
  cwd: string,
  lightpanda?: LightpandaBrowserConfig,
): string | undefined {
  if (lightpanda?.executablePath) {
    const resolved = resolveLightpandaExecutablePath(
      cwd,
      lightpanda.executablePath,
    );
    return existsSync(resolved) ? resolved : undefined;
  }

  for (const dir of defaultLightpandaSearchDirs(cwd)) {
    const candidate = lightpandaBinaryInDir(dir);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

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
  if (engine !== "lightpanda") return {};

  const env: NodeJS.ProcessEnv = {};

  const executable = discoverLightpandaExecutable(cwd, lightpanda);
  if (executable) {
    env.AGENT_BROWSER_EXECUTABLE_PATH = executable;
  } else if (lightpanda?.executablePath) {
    env.AGENT_BROWSER_EXECUTABLE_PATH = resolveLightpandaExecutablePath(
      cwd,
      lightpanda.executablePath,
    );
  }

  if (lightpanda?.telemetry === false) {
    env.LIGHTPANDA_DISABLE_TELEMETRY = "true";
  }

  return env;
}

/** Bin dirs to prepend to PATH so bash can run `lightpanda` when installed. */
export function resolveLightpandaBinDirs(
  cwd: string,
  lightpanda?: LightpandaBrowserConfig,
): string[] {
  const executable = discoverLightpandaExecutable(cwd, lightpanda);
  return executable ? [path.dirname(executable)] : [];
}

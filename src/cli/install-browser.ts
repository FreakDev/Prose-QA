import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LIGHTPANDA_INSTALL_DIR } from "../config/lightpanda.js";
import { resolveBundledPath } from "../paths.js";

export function executeInstallBrowserChrome(): number {
  try {
    execSync("npx agent-browser install --with-deps", {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    return 0;
  } catch {
    return 1;
  }
}

export function executeInstallBrowserLightpanda(): number {
  const scriptPath = resolveBundledPath(
    process.cwd(),
    "scripts/install-lightpanda.mjs",
  );
  if (!existsSync(scriptPath)) {
    console.error(
      `Lightpanda install script not found: ${scriptPath}\n` +
        "Run from the prose-qa repo or ensure scripts/install-lightpanda.mjs is present.",
    );
    return 2;
  }
  const cwd = process.cwd();
  const installDir = path.join(cwd, DEFAULT_LIGHTPANDA_INSTALL_DIR);
  try {
    execSync(`node ${JSON.stringify(scriptPath)}`, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        LIGHTPANDA_DIR: installDir,
      },
    });
    return 0;
  } catch {
    return 1;
  }
}

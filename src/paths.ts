import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedPackageRoot: string | undefined;

/** Directory containing package.json (repo root or node_modules/prose-qa). */
export function getPackageRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  cachedPackageRoot = path.resolve(dir, "..");
  return cachedPackageRoot;
}

/**
 * Resolve a project-relative path: prefer cwd override, then bundled package assets.
 */
export function resolveBundledPath(cwd: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  const cwdPath = path.resolve(cwd, relativePath);
  if (existsSync(cwdPath)) {
    return cwdPath;
  }
  const pkgPath = path.resolve(getPackageRoot(), relativePath);
  if (existsSync(pkgPath)) {
    return pkgPath;
  }
  return cwdPath;
}

function hasAgentBrowserCli(binDir: string): boolean {
  const base = path.join(binDir, "agent-browser");
  return existsSync(base) || existsSync(`${base}.cmd`);
}

/**
 * Directories to prepend to PATH so bash can run `agent-browser` without a global install.
 * Prefers the project cwd, then the prose-qa package's dependency tree.
 */
export function resolveAgentBrowserBinDirs(cwd: string): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();

  const add = (binDir: string) => {
    const resolved = path.resolve(binDir);
    if (seen.has(resolved) || !hasAgentBrowserCli(resolved)) return;
    seen.add(resolved);
    dirs.push(resolved);
  };

  add(path.join(cwd, "node_modules/.bin"));
  add(path.join(cwd, "node_modules/prose-qa/node_modules/.bin"));

  try {
    const require = createRequire(path.join(getPackageRoot(), "package.json"));
    const pkgJson = require.resolve("agent-browser/package.json");
    add(path.join(path.dirname(pkgJson), "..", ".bin"));
  } catch {
    add(path.join(getPackageRoot(), "node_modules/.bin"));
  }

  return dirs;
}

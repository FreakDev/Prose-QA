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

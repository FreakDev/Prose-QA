import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import { hashScenarioContent } from "./hash.js";
import { resolveCacheConfig } from "./resolve.js";

export interface ScenarioCacheMeta {
  scenarioName: string;
  contentHash: string;
  updatedAt: string;
  version: number;
  passCount: number;
}

export function safeScenarioDirName(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export function resolveCacheRoot(cwd: string, config: PqaConfig): string {
  const { dir } = resolveCacheConfig(config);
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

export function scenarioCacheDir(
  cwd: string,
  config: PqaConfig,
  scenarioName: string,
): string {
  return path.join(
    resolveCacheRoot(cwd, config),
    safeScenarioDirName(scenarioName),
  );
}

function metaPath(cacheDir: string): string {
  return path.join(cacheDir, "meta.json");
}

function hintsPath(cacheDir: string): string {
  return path.join(cacheDir, "hints.md");
}

function readMeta(cacheDir: string): ScenarioCacheMeta | undefined {
  const file = metaPath(cacheDir);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as ScenarioCacheMeta;
  } catch {
    return undefined;
  }
}

export function invalidateScenarioCache(
  cwd: string,
  config: PqaConfig,
  scenarioName: string,
): void {
  const dir = scenarioCacheDir(cwd, config, scenarioName);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Load hints when content hash matches; otherwise invalidate and return undefined. */
export function loadScenarioCache(
  cwd: string,
  config: PqaConfig,
  scenario: Scenario,
): string | undefined {
  const name = scenario.frontmatter.name;
  const dir = scenarioCacheDir(cwd, config, name);
  const expectedHash = hashScenarioContent(scenario);
  const meta = readMeta(dir);

  if (!meta || !existsSync(hintsPath(dir))) {
    return undefined;
  }

  if (meta.contentHash !== expectedHash) {
    invalidateScenarioCache(cwd, config, name);
    return undefined;
  }

  return readFileSync(hintsPath(dir), "utf-8").trim() || undefined;
}

export function writeScenarioCache(
  cwd: string,
  config: PqaConfig,
  scenario: Scenario,
  hints: string,
  existingMeta?: ScenarioCacheMeta,
): void {
  const name = scenario.frontmatter.name;
  const dir = scenarioCacheDir(cwd, config, name);
  mkdirSync(dir, { recursive: true });

  const meta: ScenarioCacheMeta = {
    scenarioName: name,
    contentHash: hashScenarioContent(scenario),
    updatedAt: new Date().toISOString(),
    version: 1,
    passCount: (existingMeta?.passCount ?? 0) + 1,
  };

  writeFileSync(hintsPath(dir), `${hints.trim()}\n`, "utf-8");
  writeFileSync(metaPath(dir), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
}

export function readScenarioCacheMeta(
  cwd: string,
  config: PqaConfig,
  scenarioName: string,
): ScenarioCacheMeta | undefined {
  const dir = scenarioCacheDir(cwd, config, scenarioName);
  return readMeta(dir);
}

export function listCachedScenarios(
  cwd: string,
  config: PqaConfig,
): string[] {
  const root = resolveCacheRoot(cwd, config);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function clearCache(
  cwd: string,
  config: PqaConfig,
  scenarioName?: string,
): void {
  if (scenarioName) {
    invalidateScenarioCache(cwd, config, scenarioName);
    return;
  }

  const root = resolveCacheRoot(cwd, config);
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
}

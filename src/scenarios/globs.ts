import { existsSync } from "node:fs";
import path from "node:path";
import type { PqaConfig } from "../types/config.js";

export const DEFAULT_SCENARIOS_DIR = "scenarios";

export function scenarioDiscoveryGlob(scenariosDir: string): string {
  return `${scenariosDir.replace(/\/$/, "")}/**/*.md`;
}

/** Expand directory paths (e.g. `pqa/`) into file globs. */
export function expandScenarioPatterns(patterns: string[]): string[] {
  return patterns.map((pattern) => {
    if (!pattern.includes("*") && !pattern.endsWith(".md")) {
      return `${pattern.replace(/\/$/, "")}/**/*.md`;
    }
    return pattern;
  });
}

export function inferScenariosDirFromPatterns(patterns: string[]): string | undefined {
  const first = patterns[0]?.trim();
  if (!first) return undefined;
  const segments = first.split("/").filter((segment) => segment && segment !== ".");
  return segments[0] || undefined;
}

export function resolveScenariosDir(
  config: PqaConfig,
  patterns: string[],
  cwd = process.cwd(),
): string {
  if (config.scenariosDir) {
    return config.scenariosDir.replace(/\/$/, "");
  }
  const inferred = inferScenariosDirFromPatterns(patterns);
  if (inferred) {
    return inferred;
  }
  if (existsSync(path.join(cwd, DEFAULT_SCENARIOS_DIR))) {
    return DEFAULT_SCENARIOS_DIR;
  }
  if (existsSync(path.join(cwd, "pqa"))) {
    return "pqa";
  }
  return DEFAULT_SCENARIOS_DIR;
}

export function resolveRunGlobs(
  config: PqaConfig,
  patterns: string[],
  cwd = process.cwd(),
): {
  scenariosDir: string;
  discoveryGlob: string;
  runGlobs: string[];
  /** File globs used to locate auth scenarios; matches run scope when patterns are set. */
  searchGlobs: string[];
} {
  const scenariosDir = resolveScenariosDir(config, patterns, cwd);
  const discoveryGlob = scenarioDiscoveryGlob(scenariosDir);
  const runGlobs =
    patterns.length > 0
      ? expandScenarioPatterns(patterns)
      : [discoveryGlob];
  const searchGlobs = patterns.length > 0 ? runGlobs : [discoveryGlob];
  return { scenariosDir, discoveryGlob, runGlobs, searchGlobs };
}

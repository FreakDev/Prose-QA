import type { PqaConfig } from "../types/config.js";

export const DEFAULT_SCENARIOS_DIR = "scenarios";

export function scenarioDiscoveryGlob(scenariosDir: string): string {
  return `${scenariosDir.replace(/\/$/, "")}/**/*.md`;
}

/** Expand directory paths (e.g. `scenarios/`) into file globs. */
export function expandScenarioPatterns(patterns: string[]): string[] {
  return patterns.map((pattern) => {
    if (!pattern.includes("*") && !pattern.endsWith(".md")) {
      return `${pattern.replace(/\/$/, "")}/**/*.md`;
    }
    return pattern;
  });
}

export function resolveScenariosDir(config: PqaConfig): string {
  return (config.scenariosDir ?? DEFAULT_SCENARIOS_DIR).replace(/\/$/, "");
}

export function resolveRunGlobs(
  config: PqaConfig,
  patterns: string[],
): {
  scenariosDir: string;
  discoveryGlob: string;
  runGlobs: string[];
  /** File globs used to locate related scenarios; matches run scope when patterns are set. */
  searchGlobs: string[];
} {
  const scenariosDir = resolveScenariosDir(config);
  const discoveryGlob = scenarioDiscoveryGlob(scenariosDir);
  const runGlobs =
    patterns.length > 0
      ? expandScenarioPatterns(patterns)
      : [discoveryGlob];
  const searchGlobs = patterns.length > 0 ? runGlobs : [discoveryGlob];
  return { scenariosDir, discoveryGlob, runGlobs, searchGlobs };
}

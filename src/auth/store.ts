import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AuthProfileConfig, PqaConfig } from "../types/config.js";

export interface AuthStoreEntry {
  profile: string;
  statePath: string;
  scenario?: string;
  savedAt: string;
}

interface AuthStoreIndex {
  profiles: Record<string, Omit<AuthStoreEntry, "profile">>;
}

function authDir(cwd: string): string {
  return path.resolve(cwd, ".pqa", "auth");
}

function indexPath(cwd: string): string {
  return path.join(authDir(cwd), "index.json");
}

function readIndex(cwd: string): AuthStoreIndex {
  const file = indexPath(cwd);
  if (!existsSync(file)) return { profiles: {} };
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as AuthStoreIndex;
  } catch {
    return { profiles: {} };
  }
}

function writeIndex(cwd: string, index: AuthStoreIndex): void {
  mkdirSync(authDir(cwd), { recursive: true });
  writeFileSync(indexPath(cwd), JSON.stringify(index, null, 2));
}

export function defaultStatePath(cwd: string, profile: string): string {
  return path.resolve(cwd, ".pqa", "auth", `${profile}.json`);
}

export function resolveProfilePath(cwd: string, profile: string): string {
  return path.resolve(cwd, ".pqa", "profiles", profile);
}

function profileHasBrowserData(profilePath: string): boolean {
  return (
    existsSync(path.join(profilePath, "Default", "Cookies")) ||
    existsSync(path.join(profilePath, "Default", "Network", "Cookies"))
  );
}

export function hasProfile(cwd: string, profile: string): boolean {
  return profileHasBrowserData(resolveProfilePath(cwd, profile));
}

export function clearProfile(cwd: string, profile: string): void {
  rmSync(resolveProfilePath(cwd, profile), { recursive: true, force: true });
}

export function resolveStatePath(
  cwd: string,
  profile: string,
  config: PqaConfig,
): string {
  const entry = config.auth[profile];
  if (entry?.statePath) {
    return path.resolve(cwd, entry.statePath);
  }
  return defaultStatePath(cwd, profile);
}

export function hasState(
  cwd: string,
  profile: string,
  config: PqaConfig,
): boolean {
  return hasProfile(cwd, profile);
}

export function record(
  cwd: string,
  profile: string,
  meta: { statePath: string; scenario?: string },
): void {
  const resolved = path.resolve(meta.statePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const index = readIndex(cwd);
  index.profiles[profile] = {
    statePath: resolved,
    scenario: meta.scenario,
    savedAt: new Date().toISOString(),
  };
  writeIndex(cwd, index);
}

export function list(cwd: string): AuthStoreEntry[] {
  const index = readIndex(cwd);
  return Object.entries(index.profiles).map(([profile, entry]) => ({
    profile,
    ...entry,
  }));
}

export function clear(cwd: string, profile?: string): void {
  const index = readIndex(cwd);

  if (profile) {
    const entry = index.profiles[profile];
    if (entry?.statePath && existsSync(entry.statePath)) {
      unlinkSync(entry.statePath);
    }
    clearProfile(cwd, profile);
    delete index.profiles[profile];
    writeIndex(cwd, index);
    return;
  }

  for (const [profileName, entry] of Object.entries(index.profiles)) {
    if (entry.statePath && existsSync(entry.statePath)) {
      unlinkSync(entry.statePath);
    }
    clearProfile(cwd, profileName);
  }
  writeIndex(cwd, { profiles: {} });
}

export function getAuthScenarioNames(config: PqaConfig): Set<string> {
  return new Set(
    Object.values(config.auth)
      .map((entry) => entry.scenario)
      .filter((name): name is string => Boolean(name)),
  );
}

export function getAuthEntry(
  config: PqaConfig,
  profile: string,
): AuthProfileConfig | undefined {
  return config.auth[profile];
}

export function findProfileForAuthScenario(
  config: PqaConfig,
  scenarioName: string,
): string | undefined {
  for (const [profile, entry] of Object.entries(config.auth)) {
    if (entry.scenario === scenarioName) return profile;
  }
  return undefined;
}

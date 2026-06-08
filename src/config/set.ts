import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PqaConfig } from "../types/config.js";
import { loadReferenceConfig } from "./load.js";

export const LOCAL_CONFIG_FILENAME = "pqa.config.json";

function readLocalConfig(resolved: string): Partial<PqaConfig> {
  const raw = readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as Partial<PqaConfig>;
}

export function parseConfigValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // fall through to string
    }
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function keyExistsInReference(keyPath: string[], reference: unknown): boolean {
  let current: unknown = reference;
  for (const segment of keyPath) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return false;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return false;
    }
    current = record[segment];
  }
  return true;
}

export function deepSet(
  target: Record<string, unknown>,
  keyPath: string[],
  value: unknown,
): void {
  let current: Record<string, unknown> = target;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const segment = keyPath[i];
    if (segment === undefined) continue;
    const existing = current[segment];
    if (
      existing === undefined ||
      existing === null ||
      typeof existing !== "object" ||
      Array.isArray(existing)
    ) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  const last = keyPath.at(-1);
  if (last === undefined) return;
  current[last] = value;
}

export function formatConfigFile(config: Partial<PqaConfig>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function ensureLocalConfigFile(cwd: string): string {
  const targetPath = path.resolve(cwd, LOCAL_CONFIG_FILENAME);
  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, "{}\n", "utf-8");
  }
  return targetPath;
}

export async function setConfigValue(
  key: string,
  rawValue: string,
  cwd = process.cwd(),
): Promise<void> {
  const keyPath = key.split(".").filter(Boolean);
  if (keyPath.length === 0) {
    throw new Error("Config key must not be empty");
  }

  const reference = await loadReferenceConfig();
  if (!keyExistsInReference(keyPath, reference)) {
    throw new Error(
      `Unknown config key "${key}". Key must exist in the bundled reference config.`,
    );
  }

  const configPath = ensureLocalConfigFile(cwd);
  const current = readLocalConfig(configPath);
  const parsed = parseConfigValue(rawValue);
  const next = structuredClone(current) as Record<string, unknown>;
  deepSet(next, keyPath, parsed);
  writeFileSync(configPath, formatConfigFile(next as Partial<PqaConfig>), "utf-8");
}

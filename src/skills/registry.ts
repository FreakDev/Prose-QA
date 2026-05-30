import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import type { SkillsLock } from "../types/config.js";

export function hashSkillDirectory(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      const rel = path.relative(dir, full);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        hash.update(rel);
        hash.update(readFileSync(full));
      }
    }
  };
  walk(dir);
  return `sha256:${hash.digest("hex")}`;
}

export function verifyLockDrift(cwd: string): string | null {
  const lockPath = path.join(cwd, "skills.lock.json");
  const skillDir = path.join(cwd, "skills", "agent-browser");
  if (!existsSync(lockPath) || !existsSync(skillDir)) return null;

  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as SkillsLock;
  const expected = lock["agent-browser"]?.checksum;
  if (!expected) return null;

  const actual = hashSkillDirectory(skillDir);
  if (actual !== expected) {
    return `skills/agent-browser checksum mismatch (lock: ${expected}, actual: ${actual}). Run: npm run skills:sync`;
  }
  return null;
}

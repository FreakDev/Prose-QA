#!/usr/bin/env tsx
/**
 * Vendors the agent-browser skill from the pinned npm package into skills/agent-browser/.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(ROOT, "skills", "agent-browser");
const LOCK_PATH = path.join(ROOT, "skills.lock.json");
const SKILL_NAME = "core";

function readPackageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf-8"),
  ) as { dependencies?: Record<string, string> };
  const version = pkg.dependencies?.["agent-browser"]?.replace(/^[\^~]/, "");
  if (!version) {
    throw new Error("agent-browser dependency not found in package.json");
  }
  return version;
}

function hashDirectory(dir: string): string {
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

function readLock(): { checksum: string; npmVersion: string } | null {
  if (!existsSync(LOCK_PATH)) return null;
  try {
    const lock = JSON.parse(readFileSync(LOCK_PATH, "utf-8")) as {
      "agent-browser"?: { checksum?: string; npmVersion?: string };
    };
    const entry = lock["agent-browser"];
    if (!entry?.checksum || !entry.npmVersion) return null;
    return { checksum: entry.checksum, npmVersion: entry.npmVersion };
  } catch {
    return null;
  }
}

function resolveSkillSource(): string {
  try {
    const out = execSync(`npx agent-browser skills path ${SKILL_NAME}`, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (out && existsSync(out)) return out;
  } catch {
    // fall through
  }

  const pkgRoot = path.dirname(
    fileURLToPath(import.meta.resolve("agent-browser/package.json")),
  );
  const candidates = [
    path.join(pkgRoot, "skills", SKILL_NAME),
    path.join(pkgRoot, "dist", "skills", SKILL_NAME),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "SKILL.md"))) return candidate;
  }

  throw new Error(
    `Could not locate agent-browser skill "${SKILL_NAME}". Run: npm install && agent-browser install`,
  );
}

function sync(): void {
  const npmVersion = readPackageVersion();
  const existing = readLock();

  if (existing?.npmVersion === npmVersion && existsSync(TARGET)) {
    const current = hashDirectory(TARGET);
    if (current === existing.checksum) {
      console.log(`skills/agent-browser up to date (${npmVersion})`);
      return;
    }
  }

  const source = resolveSkillSource();
  console.log(`Syncing agent-browser skill from ${source} (npm ${npmVersion})`);

  if (existsSync(TARGET)) {
    rmSync(TARGET, { recursive: true, force: true });
  }
  mkdirSync(TARGET, { recursive: true });
  cpSync(source, TARGET, { recursive: true });

  const checksum = hashDirectory(TARGET);
  const lock = {
    "agent-browser": {
      npmVersion,
      skillName: SKILL_NAME,
      syncedAt: new Date().toISOString(),
      checksum,
    },
  };
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Wrote skills/agent-browser (${checksum})`);
}

sync();

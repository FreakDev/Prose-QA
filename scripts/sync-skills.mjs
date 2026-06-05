#!/usr/bin/env node
/**
 * Vendor agent-browser skills into skills/agent-browser/.
 * - Minimal core SKILL.md (not --full inline dump)
 * - references/ and templates/ for on-demand loading
 * - bundled/ for optional specialized skills (dogfood, electron, …)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function resolveSkillDataRoot() {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const pkgJson = require.resolve("agent-browser/package.json");
  return path.join(path.dirname(pkgJson), "skill-data");
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .map((name) => name.slice(0, -ext.length))
    .sort();
}

function readSkillDescription(skillDir) {
  const skillPath = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return "";
  const raw = readFileSync(skillPath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return "";
  for (const line of match[1].split("\n")) {
    const desc = /^description:\s*(.+)$/.exec(line.trim());
    if (desc) return desc[1].trim();
  }
  return "";
}

function syncSkills() {
  const skillDataRoot = resolveSkillDataRoot();
  if (!existsSync(skillDataRoot)) {
    console.error("agent-browser skill-data not found. Run: npm install");
    process.exit(1);
  }

  const outDir = path.join(repoRoot, "skills", "agent-browser");
  const coreSrc = path.join(skillDataRoot, "core");

  if (!existsSync(path.join(coreSrc, "SKILL.md"))) {
    console.error("core/SKILL.md missing in agent-browser skill-data");
    process.exit(1);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(path.join(coreSrc, "SKILL.md"), path.join(outDir, "SKILL.md"));
  copyDir(path.join(coreSrc, "references"), path.join(outDir, "references"));
  copyDir(path.join(coreSrc, "templates"), path.join(outDir, "templates"));

  const bundledDir = path.join(outDir, "bundled");
  mkdirSync(bundledDir, { recursive: true });

  const bundled = [];
  for (const name of readdirSync(skillDataRoot)) {
    if (name === "core") continue;
    const src = path.join(skillDataRoot, name);
    if (!statSync(src).isDirectory()) continue;
    const dest = path.join(bundledDir, name);
    copyDir(src, dest);
    bundled.push({
      name,
      description: readSkillDescription(src),
    });
  }
  bundled.sort((a, b) => a.name.localeCompare(b.name));

  const manifest = {
    version: 1,
    core: {
      references: listFiles(path.join(outDir, "references"), ".md"),
      templates: listFiles(path.join(outDir, "templates"), ".sh"),
    },
    bundled,
  };

  writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const coreLines = readFileSync(path.join(outDir, "SKILL.md"), "utf8").split("\n").length;
  console.log(
    `Synced agent-browser skills → skills/agent-browser/ (core: ${coreLines} lines, ` +
      `${manifest.core.references.length} references, ${bundled.length} bundled skills)`,
  );
}

syncSkills();

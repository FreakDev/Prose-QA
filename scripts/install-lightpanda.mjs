/**
 * Download the Lightpanda browser binary for the current OS/arch.
 * @see https://lightpanda.io/docs/open-source/installation
 * @see https://github.com/lightpanda-io/browser/releases/tag/nightly
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "lightpanda-io/browser";
const VERSION = process.env.LIGHTPANDA_VERSION ?? "nightly";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const installDir = process.env.LIGHTPANDA_DIR ?? path.join(projectRoot, ".bin");
const binaryName = process.platform === "win32" ? "lightpanda.exe" : "lightpanda";
const binaryPath = path.join(installDir, binaryName);

function isMuslLinux() {
  if (process.platform !== "linux") return false;
  try {
    const out = execSync("ldd --version 2>&1 || true", { encoding: "utf8" });
    return out.toLowerCase().includes("musl");
  } catch {
    return false;
  }
}

/** @returns {string} GitHub release asset basename (e.g. lightpanda-aarch64-macos) */
function resolveAssetName() {
  const { platform, arch } = process;

  if (platform === "win32") {
    console.error(
      "Lightpanda has no native Windows binary. Install inside WSL2 (Linux steps), then point AGENT_BROWSER_EXECUTABLE_PATH at the WSL binary.\n" +
        "https://lightpanda.io/docs/open-source/installation#windows--wsl2",
    );
    process.exit(1);
  }

  if (platform === "linux" && isMuslLinux()) {
    console.error(
      "Alpine/musl Linux is not supported by the prebuilt Lightpanda binaries (glibc required).\n" +
        "Use a glibc-based image (Debian/Ubuntu) or build from source: https://github.com/lightpanda-io/browser#build-from-sources",
    );
    process.exit(1);
  }

  let osSuffix;
  if (platform === "linux") osSuffix = "linux";
  else if (platform === "darwin") osSuffix = "macos";
  else {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }

  let archSuffix;
  switch (arch) {
    case "x64":
      archSuffix = "x86_64";
      break;
    case "arm64":
      archSuffix = "aarch64";
      break;
    default:
      console.error(`Unsupported CPU architecture: ${arch}`);
      process.exit(1);
  }

  return `lightpanda-${archSuffix}-${osSuffix}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "prose-qa-install-lightpanda" },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}`);
  }
  return res.json();
}

async function sha256File(filePath) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  if (!res.body) {
    throw new Error(`Empty response body: ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function main() {
  const assetName = resolveAssetName();
  const downloadUrl = `https://github.com/${REPO}/releases/download/${VERSION}/${assetName}`;

  console.log("=== Lightpanda install ===");
  console.log(`Version: ${VERSION}`);
  console.log(`Detected: ${process.platform} ${process.arch} → ${assetName}`);
  console.log(`Install dir: ${installDir}`);

  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/${VERSION}`);
  const asset = release.assets?.find((a) => a.name === assetName);
  if (!asset?.digest) {
    throw new Error(`No checksum for asset "${assetName}" on release tag "${VERSION}"`);
  }

  const expectedSha256 = asset.digest.replace(/^sha256:/, "");
  await mkdir(installDir, { recursive: true });

  const tmpPath = `${binaryPath}.download`;
  try {
    console.log(`Downloading ${downloadUrl} ...`);
    await downloadToFile(downloadUrl, tmpPath);

    const actualSha256 = await sha256File(tmpPath);
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Checksum mismatch for ${assetName}\n  expected: ${expectedSha256}\n  actual:   ${actualSha256}`,
      );
    }

    await rename(tmpPath, binaryPath);
    await chmod(binaryPath, 0o755);

    console.log("Checksum OK.");
    console.log(`Installed: ${binaryPath}`);
    console.log("");
    console.log("Add to PATH (shell profile) or set for Prose-QA / agent-browser:");
    console.log(`  export PATH="${installDir}:$PATH"`);
    console.log(`  export AGENT_BROWSER_EXECUTABLE_PATH="${binaryPath}"`);
    console.log("");
    console.log("Start CDP server: lightpanda serve --host 127.0.0.1 --port 9222");
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

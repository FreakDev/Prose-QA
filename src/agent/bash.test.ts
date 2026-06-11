import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { getPackageRoot } from "../paths.js";
import { buildBrowserEnv, withAgentBrowserPath } from "./bash.js";

describe("withAgentBrowserPath", () => {
  it("prepends prose-qa node_modules/.bin when cwd has no local install", () => {
    const pkgBin = path.join(getPackageRoot(), "node_modules/.bin");
    const env = withAgentBrowserPath("/tmp/pqa-no-local-agent-browser", {
      PATH: "/usr/bin",
    });
    assert.ok(env.PATH?.startsWith(`${pkgBin}:`));
    assert.equal(env.PATH, env.Path);
  });
});

describe("withAgentBrowserPath lightpanda", () => {
  it("prepends project .pqa/engine when lightpanda is installed there", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-lp-path-"));
    const engineDir = path.join(cwd, ".pqa", "engine");
    mkdirSync(engineDir, { recursive: true });
    writeFileSync(path.join(engineDir, "lightpanda"), "");

    const browserEnv = buildBrowserEnv({
      cwd,
      headed: false,
      sessionName: "pqa",
      engine: "lightpanda",
      lightpanda: { executablePath: "./.pqa/engine", telemetry: false },
      artifactDir: cwd,
    });
    const env = withAgentBrowserPath(cwd, { PATH: "/usr/bin", ...browserEnv });

    const pathParts = env.PATH?.split(path.delimiter) ?? [];
    assert.ok(pathParts.includes(engineDir));
  });
});

describe("buildBrowserEnv", () => {
  it("sets AGENT_BROWSER_ENGINE from config", () => {
    const chrome = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      engine: "chrome",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(chrome.AGENT_BROWSER_ENGINE, "chrome");

    const lightpanda = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      engine: "lightpanda",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(lightpanda.AGENT_BROWSER_ENGINE, "lightpanda");
  });

  it("defaults AGENT_BROWSER_ENGINE to chrome", () => {
    const env = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.AGENT_BROWSER_ENGINE, "chrome");
  });

  it("applies lightpanda config when engine is lightpanda", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-lp-env-"));
    const binary = path.join(cwd, "custom-lightpanda");
    writeFileSync(binary, "");
    const env = buildBrowserEnv({
      cwd,
      headed: false,
      sessionName: "pqa",
      engine: "lightpanda",
      lightpanda: {
        executablePath: binary,
        telemetry: false,
      },
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.AGENT_BROWSER_ENGINE, "lightpanda");
    assert.equal(env.AGENT_BROWSER_EXECUTABLE_PATH, binary);
    assert.equal(env.LIGHTPANDA_DISABLE_TELEMETRY, "true");
  });

  it("sets AGENT_BROWSER_PROFILE when profilePath is provided", () => {
    const env = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      engine: "chrome",
      profilePath: "/tmp/.pqa/profiles/admin",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.AGENT_BROWSER_PROFILE, "/tmp/.pqa/profiles/admin");
    assert.equal(env.AGENT_BROWSER_STATE, undefined);
  });

  it("sets AGENT_BROWSER_STATE when authStatePath is provided", () => {
    const env = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      engine: "lightpanda",
      authStatePath: "/tmp/.pqa/auth/admin.json",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.AGENT_BROWSER_STATE, "/tmp/.pqa/auth/admin.json");
    assert.equal(env.AGENT_BROWSER_PROFILE, undefined);
  });

  it("does not set lightpanda env for chrome engine", () => {
    const env = buildBrowserEnv({
      cwd: "/project",
      headed: false,
      sessionName: "pqa",
      engine: "chrome",
      lightpanda: { telemetry: false },
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.LIGHTPANDA_DISABLE_TELEMETRY, undefined);
  });
});

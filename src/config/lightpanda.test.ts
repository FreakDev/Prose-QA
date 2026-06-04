import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  lightpandaBrowserEnv,
  resolveLightpandaExecutablePath,
} from "./lightpanda.js";

describe("resolveLightpandaExecutablePath", () => {
  it("appends binary name when path is a directory", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-lp-"));
    const binDir = path.join(cwd, ".bin");
    mkdirSync(binDir, { recursive: true });
    const binary = path.join(binDir, "lightpanda");
    writeFileSync(binary, "");

    assert.equal(
      resolveLightpandaExecutablePath(cwd, ".bin"),
      binary,
    );
    assert.equal(
      resolveLightpandaExecutablePath(cwd, "./"),
      path.join(cwd, "lightpanda"),
    );
  });

  it("returns absolute file path unchanged", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-lp-"));
    const binary = path.join(cwd, "custom-lightpanda");
    writeFileSync(binary, "");

    assert.equal(
      resolveLightpandaExecutablePath(cwd, "custom-lightpanda"),
      binary,
    );
    assert.equal(resolveLightpandaExecutablePath(cwd, binary), binary);
  });
});

describe("lightpandaBrowserEnv", () => {
  it("sets executable and disables telemetry for lightpanda engine", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-lp-"));
    const binDir = path.join(cwd, ".bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(path.join(binDir, "lightpanda"), "");

    const env = lightpandaBrowserEnv(cwd, "lightpanda", {
      executablePath: ".bin",
      telemetry: false,
    });

    assert.equal(env.AGENT_BROWSER_EXECUTABLE_PATH, path.join(binDir, "lightpanda"));
    assert.equal(env.LIGHTPANDA_DISABLE_TELEMETRY, "true");
  });

  it("returns empty env for chrome engine", () => {
    assert.deepEqual(
      lightpandaBrowserEnv("/tmp", "chrome", {
        executablePath: ".bin",
        telemetry: false,
      }),
      {},
    );
  });
});

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { getPackageRoot } from "../paths.js";
import type { PqaConfig } from "../types/config.js";
import {
  loadConfig,
  resolveAgentParallel,
  resolveBrowserHeaded,
} from "./load.js";

const minimalConfig = (engine: PqaConfig["browser"]["engine"]): PqaConfig => ({
  llm: { provider: "anthropic", model: "x" },
  browser: {
    headed: true,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine,
  },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 30, bashTimeoutMs: 120_000 },
  auth: {},
});

describe("resolveAgentParallel", () => {
  it("uses CLI --parallel when provided", () => {
    const config = minimalConfig("chrome");
    assert.equal(resolveAgentParallel(config, 4), 4);
    assert.equal(
      resolveAgentParallel(config, Number.POSITIVE_INFINITY),
      Number.POSITIVE_INFINITY,
    );
  });

  it("falls back to agent.parallel when CLI omits --parallel", () => {
    const config = {
      ...minimalConfig("chrome"),
      agent: { ...minimalConfig("chrome").agent, parallel: 3 },
    };
    assert.equal(resolveAgentParallel(config), 3);
    assert.equal(resolveAgentParallel({ ...config, agent: { ...config.agent, parallel: 0 } }), undefined);
    assert.equal(
      resolveAgentParallel({ ...config, agent: { ...config.agent, parallel: -1 } }),
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("resolveBrowserHeaded", () => {
  it("forces headless when engine is lightpanda", () => {
    assert.equal(resolveBrowserHeaded(minimalConfig("lightpanda")), false);
    assert.equal(resolveBrowserHeaded(minimalConfig("lightpanda"), true), false);
    assert.equal(
      resolveBrowserHeaded(minimalConfig("lightpanda"), false),
      false,
    );
  });

  it("honors headed flag and config default for chrome", () => {
    assert.equal(resolveBrowserHeaded(minimalConfig("chrome")), true);
    assert.equal(resolveBrowserHeaded(minimalConfig("chrome"), false), false);
    assert.equal(resolveBrowserHeaded(minimalConfig("chrome"), true), true);
  });
});

describe("loadConfig", () => {
  it("loads bundled pqa.config.ts when no local config exists", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-"));
    const config = await loadConfig(undefined, cwd);

    assert.equal(config.llm.provider, "anthropic");
    assert.equal(config.llm.model, "claude-sonnet-4-20250514");
    assert.equal(config.llm.thinking?.enabled, true);
    assert.equal(config.healing?.enabled, true);
    assert.equal(config.healing?.maxRecoveryTurns, 2);
    assert.deepEqual(config.envVars, []);
    assert.equal(config.auth.admin?.scenario, "login-admin");
    assert.equal(config.recorder?.bridgePort, 17_321);
    assert.equal(config.scenariosDir, "scenarios");
    assert.equal(config.agent.parallel, 0);
  });

  it("merges local pqa.config.json overrides", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-"));
    writeFileSync(
      path.join(cwd, "pqa.config.json"),
      JSON.stringify({ scenariosDir: "custom-scenarios" }),
    );
    const config = await loadConfig(undefined, cwd);
    assert.equal(config.scenariosDir, "custom-scenarios");
  });

  it("deep-merges browser.lightpanda overrides", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-"));
    writeFileSync(
      path.join(cwd, "pqa.config.json"),
      JSON.stringify({
        browser: { lightpanda: { executablePath: ".bin/custom" } },
      }),
    );
    const config = await loadConfig(undefined, cwd);
    assert.equal(config.browser.lightpanda?.executablePath, ".bin/custom");
    assert.equal(config.browser.lightpanda?.telemetry, false);
  });

  it("resolves bundled config from the package root", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-"));
    const config = await loadConfig(undefined, cwd);
    const bundledPath = path.resolve(getPackageRoot(), "pqa.config.ts");

    assert.equal(
      config.systemPromptPath,
      path.resolve(getPackageRoot(), "prompt/SYSTEM.md"),
    );
    assert.match(bundledPath, /pqa\.config\.ts$/);
  });
});

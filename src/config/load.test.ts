import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { getPackageRoot } from "../paths.js";
import { loadSystemPrompt } from "../prompt/load.js";
import type { PqaConfig } from "../types/config.js";
import {
  loadConfig,
  missingLlmApiKey,
  missingLlmConfig,
  PQA_LLM_API_KEY,
  resolveAgentParallel,
  resolveBrowserHeaded,
  resolveSensitiveEnvVars,
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
    const prevProvider = process.env.PQA_LLM_PROVIDER;
    const prevModel = process.env.PQA_LLM_MODEL;
    process.env.PQA_LLM_PROVIDER = "fireworks";
    process.env.PQA_LLM_MODEL = "accounts/fireworks/models/test";
    try {
      const config = await loadConfig(undefined, cwd);
      assert.equal(config.llm.provider, "fireworks");
      assert.equal(config.llm.model, "accounts/fireworks/models/test");
      assert.equal(config.llm.thinking?.enabled, true);
      assert.equal(config.healing?.enabled, true);
      assert.equal(config.healing?.maxRecoveryTurns, 2);
      assert.deepEqual(config.envVars, [
        "PQA_TEST_EMAIL",
        "PQA_TEST_PASSWORD",
      ]);
      assert.deepEqual(config.auth?.admin, { scenario: "login-admin" });
      assert.equal(config.recorder?.bridgePort, 17_321);
      assert.equal(config.scenariosDir, "scenarios");
      assert.equal(config.agent.parallel, 0);
      assert.deepEqual(config.skills.dirs, [
        path.resolve(cwd, ".pqa/skills"),
      ]);
      assert.deepEqual(config.skills.preloads, []);
    } finally {
      if (prevProvider === undefined) delete process.env.PQA_LLM_PROVIDER;
      else process.env.PQA_LLM_PROVIDER = prevProvider;
      if (prevModel === undefined) delete process.env.PQA_LLM_MODEL;
      else process.env.PQA_LLM_MODEL = prevModel;
    }
  });

  it("has no default llm.provider or llm.model without env or local config", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-"));
    const prevProvider = process.env.PQA_LLM_PROVIDER;
    const prevModel = process.env.PQA_LLM_MODEL;
    delete process.env.PQA_LLM_PROVIDER;
    delete process.env.PQA_LLM_MODEL;
    try {
      const config = await loadConfig(undefined, cwd);
      assert.equal(config.llm.provider, undefined);
      assert.equal(config.llm.model, undefined);
      assert.match(missingLlmConfig(config)!, /llm\.provider/);
    } finally {
      if (prevProvider === undefined) delete process.env.PQA_LLM_PROVIDER;
      else process.env.PQA_LLM_PROVIDER = prevProvider;
      if (prevModel === undefined) delete process.env.PQA_LLM_MODEL;
      else process.env.PQA_LLM_MODEL = prevModel;
    }
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

  it("prefers llm.provider and llm.model from pqa.config.json over env vars", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-"));
    writeFileSync(
      path.join(cwd, "pqa.config.json"),
      JSON.stringify({
        llm: { provider: "ollama", model: "gemma4:e2b" },
      }),
    );
    const prevProvider = process.env.PQA_LLM_PROVIDER;
    const prevModel = process.env.PQA_LLM_MODEL;
    process.env.PQA_LLM_PROVIDER = "fireworks";
    process.env.PQA_LLM_MODEL = "accounts/fireworks/models/test";
    try {
      const config = await loadConfig(undefined, cwd);
      assert.equal(config.llm.provider, "ollama");
      assert.equal(config.llm.model, "gemma4:e2b");
    } finally {
      if (prevProvider === undefined) delete process.env.PQA_LLM_PROVIDER;
      else process.env.PQA_LLM_PROVIDER = prevProvider;
      if (prevModel === undefined) delete process.env.PQA_LLM_MODEL;
      else process.env.PQA_LLM_MODEL = prevModel;
    }
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

    assert.match(bundledPath, /pqa\.config\.ts$/);
    assert.ok(loadSystemPrompt(cwd).includes("ProseQA"));
  });
});

describe("missingLlmApiKey", () => {
  it("requires PQA_LLM_API_KEY for cloud providers", () => {
    const config = minimalConfig("chrome");
    assert.match(
      missingLlmApiKey(config)!,
      new RegExp(PQA_LLM_API_KEY),
    );
  });

  it("does not require an API key for ollama", () => {
    const config = {
      ...minimalConfig("chrome"),
      llm: { provider: "ollama" as const, model: "llama3.2" },
    };
    assert.equal(missingLlmApiKey(config), undefined);
  });
});

describe("resolveSensitiveEnvVars", () => {
  it("includes PQA_LLM_API_KEY for cloud providers", () => {
    const names = resolveSensitiveEnvVars(minimalConfig("chrome"));
    assert.deepEqual(names, [PQA_LLM_API_KEY]);
  });
});

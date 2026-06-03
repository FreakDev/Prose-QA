import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import { hashScenarioContent } from "./hash.js";
import { isCacheEnabled } from "./resolve.js";
import {
  clearCache,
  loadScenarioCache,
  safeScenarioDirName,
  writeScenarioCache,
} from "./store.js";

const baseConfig: PqaConfig = {
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 100, bashTimeoutMs: 120_000 },
  auth: {},
  cache: { dir: ".pqa/cache", enabled: true },
};

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    filePath: "/tmp/example.md",
    frontmatter: { name: "example-smoke" },
    skills: [],
    goal: "Goal",
    steps: "Steps",
    then: ["then one"],
    rawCheckpoints: ["then one"],
    checkpoints: [{ raw: "then one", kind: "unknown" }],
    ...overrides,
  };
}

describe("isCacheEnabled", () => {
  it("returns false when noCache is set", () => {
    assert.equal(isCacheEnabled(baseConfig, true), false);
  });

  it("returns false when cache.enabled is false", () => {
    assert.equal(
      isCacheEnabled({ ...baseConfig, cache: { enabled: false } }),
      false,
    );
  });
});

describe("scenario cache store", () => {
  it("writes and loads hints when hash matches", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-cache-"));
    const scenario = makeScenario();
    writeScenarioCache(cwd, baseConfig, scenario, "## Effective actions\n- click @e1");

    const loaded = loadScenarioCache(cwd, baseConfig, scenario);
    assert.match(loaded ?? "", /Effective actions/);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("invalidates cache when expanded content changes", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-cache-"));
    const scenario = makeScenario();
    writeScenarioCache(cwd, baseConfig, scenario, "old hints");

    const dir = path.join(cwd, ".pqa", "cache", safeScenarioDirName("example-smoke"));
    assert.ok(existsSync(dir));

    const changed = makeScenario({ steps: "New steps" });
    const loaded = loadScenarioCache(cwd, baseConfig, changed);
    assert.equal(loaded, undefined);
    assert.equal(existsSync(dir), false);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("clearCache removes one or all entries", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-cache-"));
    writeScenarioCache(cwd, baseConfig, makeScenario({ frontmatter: { name: "a" } }), "a");
    writeScenarioCache(cwd, baseConfig, makeScenario({ frontmatter: { name: "b" } }), "b");

    clearCache(cwd, baseConfig, "a");
    assert.equal(loadScenarioCache(cwd, baseConfig, makeScenario({ frontmatter: { name: "a" } })), undefined);
    assert.ok(loadScenarioCache(cwd, baseConfig, makeScenario({ frontmatter: { name: "b" } })));

    clearCache(cwd, baseConfig);
    assert.equal(existsSync(path.join(cwd, ".pqa", "cache")), false);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("ignores stale meta hash on disk without matching scenario", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-cache-"));
    const scenario = makeScenario();
    const dir = path.join(cwd, ".pqa", "cache", safeScenarioDirName("example-smoke"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "hints.md"), "stale\n");
    writeFileSync(
      path.join(dir, "meta.json"),
      `${JSON.stringify({
        scenarioName: "example-smoke",
        contentHash: "deadbeef",
        updatedAt: new Date().toISOString(),
        version: 1,
        passCount: 1,
      })}\n`,
    );

    assert.equal(loadScenarioCache(cwd, baseConfig, scenario), undefined);
    assert.equal(existsSync(dir), false);

    rmSync(cwd, { recursive: true, force: true });
  });

  it("increments passCount on write", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-cache-"));
    const scenario = makeScenario();
    writeScenarioCache(cwd, baseConfig, scenario, "v1");
    const dir = path.join(cwd, ".pqa", "cache", safeScenarioDirName("example-smoke"));
    const meta1 = JSON.parse(
      readFileSync(path.join(dir, "meta.json"), "utf-8"),
    ) as import("./store.js").ScenarioCacheMeta;
    assert.equal(meta1.passCount, 1);
    assert.equal(meta1.contentHash, hashScenarioContent(scenario));

    writeScenarioCache(cwd, baseConfig, scenario, "v2", meta1);
    const meta2 = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf-8")) as {
      passCount: number;
    };
    assert.equal(meta2.passCount, 2);

    rmSync(cwd, { recursive: true, force: true });
  });
});

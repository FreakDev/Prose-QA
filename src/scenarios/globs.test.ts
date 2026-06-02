import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import {
  DEFAULT_SCENARIOS_DIR,
  expandScenarioPatterns,
  inferScenariosDirFromPatterns,
  resolveRunGlobs,
  resolveScenariosDir,
  scenarioDiscoveryGlob,
} from "./globs.js";

const baseConfig = {} as PqaConfig;

describe("expandScenarioPatterns", () => {
  it("expands directory paths into markdown globs", () => {
    assert.deepEqual(expandScenarioPatterns(["pqa/"]), ["pqa/**/*.md"]);
    assert.deepEqual(expandScenarioPatterns(["pqa"]), ["pqa/**/*.md"]);
    assert.deepEqual(expandScenarioPatterns(["pqa/**/*.md"]), ["pqa/**/*.md"]);
  });
});

describe("inferScenariosDirFromPatterns", () => {
  it("uses the first path segment as the scenarios root", () => {
    assert.equal(inferScenariosDirFromPatterns(["pqa/**/*.md"]), "pqa");
    assert.equal(inferScenariosDirFromPatterns(["pqa/pilar/p1/*.md"]), "pqa");
    assert.equal(inferScenariosDirFromPatterns(["./pqa/pilar-smoke.md"]), "pqa");
  });
});

describe("resolveScenariosDir", () => {
  it("prefers config.scenariosDir when set", () => {
    assert.equal(
      resolveScenariosDir({ scenariosDir: "custom" } as PqaConfig, []),
      "custom",
    );
  });

  it("auto-detects pqa/ when scenarios/ is missing", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-globs-"));
    mkdirSync(path.join(cwd, "pqa"));
    assert.equal(resolveScenariosDir(baseConfig, [], cwd), "pqa");
  });

  it("defaults to scenarios when neither directory exists", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-globs-"));
    assert.equal(resolveScenariosDir(baseConfig, [], cwd), DEFAULT_SCENARIOS_DIR);
  });
});

describe("resolveRunGlobs", () => {
  it("uses discovery glob for auth lookup and expanded patterns for filtering", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-globs-"));
    mkdirSync(path.join(cwd, "pqa"));
    const { discoveryGlob, runGlobs, searchGlobs } = resolveRunGlobs(baseConfig, ["pqa/"], cwd);
    assert.equal(discoveryGlob, scenarioDiscoveryGlob("pqa"));
    assert.deepEqual(runGlobs, ["pqa/**/*.md"]);
    assert.deepEqual(searchGlobs, runGlobs);
  });

  it("uses config.scenariosDir when no patterns are provided", () => {
    const config = { scenariosDir: "scenarios_test" } as PqaConfig;
    const { discoveryGlob, runGlobs, searchGlobs } = resolveRunGlobs(config, []);
    assert.equal(discoveryGlob, "scenarios_test/**/*.md");
    assert.deepEqual(runGlobs, ["scenarios_test/**/*.md"]);
    assert.deepEqual(searchGlobs, runGlobs);
  });
});

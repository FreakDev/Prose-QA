import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import {
  DEFAULT_SCENARIOS_DIR,
  expandScenarioPatterns,
  resolveRunGlobs,
  resolveScenariosDir,
} from "./globs.js";

const baseConfig = {} as PqaConfig;

describe("expandScenarioPatterns", () => {
  it("expands directory paths into markdown globs", () => {
    assert.deepEqual(expandScenarioPatterns(["scenarios/"]), ["scenarios/**/*.md"]);
    assert.deepEqual(expandScenarioPatterns(["scenarios"]), ["scenarios/**/*.md"]);
    assert.deepEqual(expandScenarioPatterns(["scenarios/**/*.md"]), ["scenarios/**/*.md"]);
  });
});

describe("resolveScenariosDir", () => {
  it("uses config.scenariosDir when set", () => {
    assert.equal(
      resolveScenariosDir({ scenariosDir: "custom" } as PqaConfig),
      "custom",
    );
  });

  it("defaults to scenarios when omitted from config", () => {
    assert.equal(resolveScenariosDir(baseConfig), DEFAULT_SCENARIOS_DIR);
  });
});

describe("resolveRunGlobs", () => {
  it("uses discovery glob for scenario lookup and expanded patterns for filtering", () => {
    const { discoveryGlob, runGlobs, searchGlobs } = resolveRunGlobs(
      { scenariosDir: "scenarios" } as PqaConfig,
      ["scenarios/smoke/"],
    );
    assert.equal(discoveryGlob, "scenarios/**/*.md");
    assert.deepEqual(runGlobs, ["scenarios/smoke/**/*.md"]);
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

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PreBatchHook, PreScenarioHook } from "../types/hooks.js";
import {
  defaultExtensionHooks,
  mergeExtensionHooks,
} from "./defaults.js";

describe("defaultExtensionHooks", () => {
  it("includes preBatch and preScenario auth hooks", () => {
    assert.ok(defaultExtensionHooks.preBatch);
    assert.ok(defaultExtensionHooks.preScenario);
    assert.equal(defaultExtensionHooks.preBatch!.length, 1);
    assert.equal(defaultExtensionHooks.preScenario!.length, 1);
  });
});

describe("mergeExtensionHooks", () => {
  const baseHook: PreBatchHook = async () => ({ action: "continue" });
  const extraHook: PreScenarioHook = async () => ({ action: "continue" });

  it("appends override hooks by default", () => {
    const merged = mergeExtensionHooks(
      { preBatch: [baseHook] },
      { preBatch: [baseHook], preScenario: [extraHook] },
    );
    assert.equal(merged.preBatch!.length, 2);
    assert.equal(merged.preScenario!.length, 1);
  });

  it("replaces only overridden slots when mode is replace", () => {
    const merged = mergeExtensionHooks(
      { preBatch: [baseHook], preScenario: [extraHook] },
      { preScenario: [extraHook] },
      "replace",
    );
    assert.equal(merged.preBatch!.length, 1);
    assert.equal(merged.preScenario!.length, 1);
  });
});

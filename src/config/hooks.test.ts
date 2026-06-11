import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PreScenarioHook } from "../types/hooks.js";
import type { PqaConfig } from "../types/config.js";
import { ensureProfileHook } from "../hooks/ensure-profile.js";
import {
  resolveAllHookModules,
  resolveConfigExtensionHooks,
  resolveHookModules,
} from "./hooks.js";

describe("resolveHookModules", () => {
  it("keeps inline functions as-is", async () => {
    const fn: PreScenarioHook = () => ({ action: "continue" });
    const result = await resolveHookModules<PreScenarioHook>([fn], "/test");
    assert.equal(result.length, 1);
    assert.equal(result[0], fn);
  });

  it("resolves a .mjs module from a file path", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-hooks-test-"));
    const filePath = path.join(dir, "test-hook.mjs");
    writeFileSync(
      filePath,
      `
export default function hook() {
  return { action: "continue" };
}
`,
      "utf-8",
    );
    const result = await resolveHookModules<PreScenarioHook>([filePath], dir);
    assert.equal(result.length, 1);
    assert.equal(typeof result[0], "function");
  });

  it("resolves a .js module from a file path", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-hooks-test-"));
    const filePath = path.join(dir, "test-hook.cjs");
    writeFileSync(
      filePath,
      `
module.exports = function hook() {
  return { action: "continue" };
};
`,
      "utf-8",
    );
    const result = await resolveHookModules<PreScenarioHook>([filePath], dir);
    assert.equal(result.length, 1);
    assert.equal(typeof result[0], "function");
  });

  it("skips invalid paths with a warning", async () => {
    const result = await resolveHookModules<PreScenarioHook>(
      ["./nonexistent-hook.mjs"],
      "/tmp",
    );
    assert.equal(result.length, 0);
  });

  it("handles a mix of functions and paths", async () => {
    const fn: PreScenarioHook = () => ({ action: "continue" });
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-hooks-test-"));
    const filePath = path.join(dir, "mix-hook.mjs");
    writeFileSync(
      filePath,
      `
export default function hook() {
  return { action: "skip", reason: "from-module" };
}
`,
      "utf-8",
    );
    const result = await resolveHookModules<PreScenarioHook>(
      [fn, filePath],
      dir,
    );
    assert.equal(result.length, 2);
    assert.equal(result[0], fn);
    assert.equal(typeof result[1], "function");
  });

  it("skips non-function exports", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-hooks-test-"));
    const filePath = path.join(dir, "non-fn.mjs");
    writeFileSync(
      filePath,
      `
export default { not: "a function" };
`,
      "utf-8",
    );
    const result = await resolveHookModules<PreScenarioHook>([filePath], dir);
    assert.equal(result.length, 0);
  });

  it("returns empty array for undefined or empty input", async () => {
    const result1 = await resolveHookModules<PreScenarioHook>(undefined, "/test");
    assert.deepEqual(result1, []);
    const result2 = await resolveHookModules<PreScenarioHook>([], "/test");
    assert.deepEqual(result2, []);
  });
});

describe("resolveAllHookModules", () => {
  it("resolves all hook slots", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-hooks-all-"));
    const filePath = path.join(dir, "hook.mjs");
    writeFileSync(
      filePath,
      `
export default function hook() {
  return { action: "continue" };
}
`,
      "utf-8",
    );

    const fn1: PreScenarioHook = () => ({ action: "continue" });

    const hooks = {
      preScenario: [fn1],
      preSystemPrompt: [filePath],
    };

    const resolved = await resolveAllHookModules(hooks as any, dir);
    assert.ok(resolved.preScenario);
    assert.equal(resolved.preScenario!.length, 1);
    assert.equal(resolved.preScenario![0], fn1);
    assert.ok(resolved.preSystemPrompt);
    assert.equal(resolved.preSystemPrompt!.length, 1);
    assert.equal(typeof resolved.preSystemPrompt![0], "function");
  });

  it("omits slots that end up empty", async () => {
    const hooks = {
      preScenario: [],
      preSystemPrompt: ["./nonexistent.mjs"],
    };
    const resolved = await resolveAllHookModules(hooks as any, "/tmp");
    assert.equal(resolved.preScenario, undefined);
    assert.equal(resolved.preSystemPrompt, undefined);
  });
});

describe("resolveConfigExtensionHooks", () => {
  it("prepends ensureProfile when auth profiles are configured", async () => {
    const config: PqaConfig = {
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      browser: {
        headed: false,
        sessionName: "pqa",
        defaultTimeout: 25_000,
        engine: "chrome",
      },
      skills: { dirs: [], preloads: [] },
      agent: { maxTurns: 100, bashTimeoutMs: 120_000 },
      auth: { admin: { scenario: "login-admin" } },
    };

    const resolved = await resolveConfigExtensionHooks(config, "/tmp");
    assert.ok(resolved?.preScenario);
    assert.equal(resolved!.preScenario![0], ensureProfileHook);
  });

  it("returns undefined when no auth and no user hooks", async () => {
    const config: PqaConfig = {
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      browser: {
        headed: false,
        sessionName: "pqa",
        defaultTimeout: 25_000,
        engine: "chrome",
      },
      skills: { dirs: [], preloads: [] },
      agent: { maxTurns: 100, bashTimeoutMs: 120_000 },
    };

    const resolved = await resolveConfigExtensionHooks(config, "/tmp");
    assert.equal(resolved, undefined);
  });
});

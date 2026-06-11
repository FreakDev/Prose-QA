import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import type { HookContext } from "../types/hooks.js";
import type { Scenario } from "../types/scenario.js";
import { resolveProfilePath } from "../auth/store.js";
import { ensureProfileHook } from "./ensure-profile.js";

function makeScenario(auth?: string): Scenario {
  return {
    filePath: "/tmp/checkout.md",
    frontmatter: { name: "checkout", ...(auth ? { auth } : {}) },
    skills: [],
    goal: "Buy item",
    steps: "1. Checkout",
    then: ['page shows "Done"'],
    rawCheckpoints: ['page shows "Done"'],
    checkpoints: [{ raw: 'page shows "Done"', kind: "page_shows", value: "Done" }],
  };
}

function makeContext(
  cwd: string,
  config: PqaConfig,
  metadata: Record<string, unknown> = {},
): HookContext {
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    cwd,
    config,
    transcript: { entries: [] },
    metadata,
    abort: (reason: string): never => {
      throw new Error(reason);
    },
  };
}

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

describe("ensureProfileHook", () => {
  it("continues without browserContext when scenario has no auth", async () => {
    const result = await ensureProfileHook(
      makeScenario(),
      makeContext("/tmp", config, { ensureAuthContext: {} }),
    );
    assert.equal(result.action, "continue");
    if (result.action === "continue") {
      assert.equal(result.browserContext, undefined);
    }
  });

  it("continues during provisioning nested runs", async () => {
    const result = await ensureProfileHook(
      makeScenario("admin"),
      makeContext("/tmp", config, { provisioning: true }),
    );
    assert.equal(result.action, "continue");
  });

  it("aborts when auth profile is missing from config", async () => {
    const result = await ensureProfileHook(
      makeScenario("missing"),
      makeContext("/tmp", config, { ensureAuthContext: {} }),
    );
    assert.equal(result.action, "abort");
  });

  it("returns browserContext when chrome profile already exists", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-ensure-profile-"));
    try {
      const profilePath = resolveProfilePath(cwd, "admin");
      mkdirSync(path.join(profilePath, "Default", "Network"), {
        recursive: true,
      });
      writeFileSync(path.join(profilePath, "Default", "Network", "Cookies"), "x");

      const result = await ensureProfileHook(
        makeScenario("admin"),
        makeContext(cwd, config, {
          ensureAuthContext: {
            config,
            allSkills: [],
            baseSkillNames: ["core"],
            cwd,
            runDir: path.join(cwd, ".pqa", "runs", "test"),
            headed: false,
            allScenarios: [],
            artifacts: "never",
            redactor: { redact: (s: string) => s } as never,
          },
        }),
      );

      assert.equal(result.action, "continue");
      if (result.action === "continue") {
        assert.equal(result.browserContext?.profilePath, profilePath);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

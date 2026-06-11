import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { PqaConfig } from "../types/config.js";
import {
  hasState,
  resolveBrowserContextForProfile,
  resolveProfilePath,
} from "./store.js";

function baseConfig(engine: PqaConfig["browser"]["engine"]): PqaConfig {
  return {
    llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    browser: {
      headed: false,
      sessionName: "pqa",
      defaultTimeout: 25_000,
      engine,
    },
    skills: { dirs: [], preloads: [] },
    agent: { maxTurns: 100, bashTimeoutMs: 120_000 },
    auth: {
      admin: { scenario: "login-admin" },
    },
  };
}

describe("hasState", () => {
  it("uses chrome profile directory when engine is chrome", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-auth-store-"));
    try {
      const profilePath = resolveProfilePath(cwd, "admin");
      mkdirSync(path.join(profilePath, "Default", "Network"), {
        recursive: true,
      });
      writeFileSync(path.join(profilePath, "Default", "Network", "Cookies"), "x");

      assert.equal(hasState(cwd, "admin", baseConfig("chrome")), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses state JSON when engine is lightpanda", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-auth-store-"));
    try {
      const statePath = path.join(cwd, ".pqa", "auth", "admin.json");
      mkdirSync(path.dirname(statePath), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify({ cookies: [{ name: "session", value: "abc" }] }),
      );

      assert.equal(hasState(cwd, "admin", baseConfig("lightpanda")), true);
      assert.equal(existsSync(resolveProfilePath(cwd, "admin")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("resolveBrowserContextForProfile", () => {
  it("returns profilePath for chrome", () => {
    const cwd = "/tmp/project";
    const ctx = resolveBrowserContextForProfile(
      baseConfig("chrome"),
      cwd,
      "admin",
    );
    assert.equal(ctx.profilePath, path.resolve(cwd, ".pqa", "profiles", "admin"));
    assert.equal(ctx.authStatePath, undefined);
  });

  it("returns authStatePath for lightpanda", () => {
    const cwd = "/tmp/project";
    const ctx = resolveBrowserContextForProfile(
      baseConfig("lightpanda"),
      cwd,
      "admin",
    );
    assert.equal(
      ctx.authStatePath,
      path.resolve(cwd, ".pqa", "auth", "admin.json"),
    );
    assert.equal(ctx.profilePath, undefined);
  });
});

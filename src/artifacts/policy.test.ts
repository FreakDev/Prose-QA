import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyArtifactsPolicy,
  BROWSER_ARTIFACT_FILES,
  formatArtifactsRuntimeHint,
  pruneBrowserArtifacts,
} from "./policy.js";

function seedBrowserArtifacts(dir: string): void {
  for (const name of BROWSER_ARTIFACT_FILES) {
    writeFileSync(path.join(dir, name), "test");
  }
}

describe("formatArtifactsRuntimeHint", () => {
  it("documents never mode", () => {
    const hint = formatArtifactsRuntimeHint("never");
    assert.match(hint, /disabled/i);
    assert.match(hint, /Do NOT write failure\.png/);
  });

  it("documents always mode", () => {
    const hint = formatArtifactsRuntimeHint("always");
    assert.match(hint, /pass or fail/i);
    assert.match(hint, /failure\.png/);
  });

  it("documents on-failure mode", () => {
    const hint = formatArtifactsRuntimeHint("on-failure");
    assert.match(hint, /on failure only/i);
    assert.match(hint, /failure\.png/);
  });
});

describe("applyArtifactsPolicy", () => {
  it("removes browser artifacts when mode is never", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-artifacts-"));
    seedBrowserArtifacts(dir);
    applyArtifactsPolicy(dir, "never", { status: "fail" });
    for (const name of BROWSER_ARTIFACT_FILES) {
      assert.equal(existsSync(path.join(dir, name)), false);
    }
  });

  it("removes browser artifacts on pass when mode is on-failure", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-artifacts-"));
    seedBrowserArtifacts(dir);
    writeFileSync(path.join(dir, "transcript.json"), "{}");
    applyArtifactsPolicy(dir, "on-failure", { status: "pass" });
    for (const name of BROWSER_ARTIFACT_FILES) {
      assert.equal(existsSync(path.join(dir, name)), false);
    }
    assert.equal(existsSync(path.join(dir, "transcript.json")), true);
  });

  it("keeps browser artifacts on fail when mode is on-failure", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-artifacts-"));
    seedBrowserArtifacts(dir);
    applyArtifactsPolicy(dir, "on-failure", { status: "fail" });
    for (const name of BROWSER_ARTIFACT_FILES) {
      assert.equal(existsSync(path.join(dir, name)), true);
    }
  });

  it("keeps browser artifacts on pass when mode is always", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-artifacts-"));
    seedBrowserArtifacts(dir);
    applyArtifactsPolicy(dir, "always", { status: "pass" });
    for (const name of BROWSER_ARTIFACT_FILES) {
      assert.equal(existsSync(path.join(dir, name)), true);
    }
  });
});

describe("pruneBrowserArtifacts", () => {
  it("is a no-op when files are missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-artifacts-"));
    mkdirSync(dir, { recursive: true });
    assert.doesNotThrow(() => pruneBrowserArtifacts(dir));
  });
});

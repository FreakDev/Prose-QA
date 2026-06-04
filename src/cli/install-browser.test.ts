import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../paths.js";
import { executeHelp } from "./help.js";

describe("install-browser help", () => {
  it("documents chrome and lightpanda subcommands", () => {
    assert.equal(executeHelp(["install-browser", "chrome"]), 0);
    assert.equal(executeHelp(["install-browser", "lightpanda"]), 0);
  });
});

describe("install-lightpanda script", () => {
  it("is bundled in the package root", () => {
    const script = path.join(getPackageRoot(), "scripts/install-lightpanda.mjs");
    assert.ok(existsSync(script));
  });
});

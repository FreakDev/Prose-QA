import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCliInvocation } from "./subprocess.js";

describe("resolveCliInvocation", () => {
  it("returns node + script path for compiled CLI", () => {
    const original = process.argv[1];
    process.argv[1] = "/project/dist/cli/index.js";
    try {
      const inv = resolveCliInvocation();
      assert.equal(inv.command, process.execPath);
      assert.deepEqual(inv.baseArgs, ["/project/dist/cli/index.js"]);
    } finally {
      if (original !== undefined) {
        process.argv[1] = original;
      }
    }
  });

  it("uses tsx loader for TypeScript CLI entry", () => {
    const original = process.argv[1];
    process.argv[1] = "/project/src/cli/index.ts";
    try {
      const inv = resolveCliInvocation();
      assert.equal(inv.command, process.execPath);
      assert.deepEqual(inv.baseArgs, [
        "--import",
        "tsx",
        "/project/src/cli/index.ts",
      ]);
    } finally {
      if (original !== undefined) {
        process.argv[1] = original;
      }
    }
  });
});

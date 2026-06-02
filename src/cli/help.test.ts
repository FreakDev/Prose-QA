import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeHelp, printTopLevelHelp } from "./help.js";

describe("executeHelp", () => {
  it("returns 0 for top-level help", () => {
    assert.equal(executeHelp([]), 0);
  });

  it("returns 0 for known command", () => {
    assert.equal(executeHelp(["run"]), 0);
    assert.equal(executeHelp(["skills", "list"]), 0);
  });

  it("returns 2 for unknown command", () => {
    assert.equal(executeHelp(["nope"]), 2);
    assert.equal(executeHelp(["skills", "nope"]), 2);
  });
});

describe("printTopLevelHelp", () => {
  it("lists every command", () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      printTopLevelHelp();
    } finally {
      console.log = log;
    }
    const text = lines.join("\n");
    assert.match(text, /run/);
    assert.match(text, /debug/);
    assert.match(text, /skills/);
    assert.match(text, /auth/);
    assert.match(text, /config/);
    assert.match(text, /mcp/);
    assert.match(text, /help/);
    assert.match(text, /--version/);
  });
});

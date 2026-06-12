import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentBrowserAction } from "./parse-command.js";

describe("parseAgentBrowserAction", () => {
  it("parses click with ref", () => {
    const parsed = parseAgentBrowserAction("agent-browser click @e3");
    assert.equal(parsed?.category, "mutation");
    assert.equal(parsed?.subcommand, "click");
    assert.equal(parsed?.target, "@e3");
    assert.equal(parsed?.label, "Click @e3");
  });

  it("parses fill without exposing value in label", () => {
    const parsed = parseAgentBrowserAction(
      'agent-browser fill @e5 "secret-password"',
    );
    assert.equal(parsed?.category, "mutation");
    assert.equal(parsed?.target, "@e5");
    assert.equal(parsed?.label, "Fill @e5");
    assert.equal(parsed?.label.includes("secret"), false);
  });

  it("parses snapshot observation", () => {
    const parsed = parseAgentBrowserAction("agent-browser snapshot -i");
    assert.equal(parsed?.category, "observation");
    assert.equal(parsed?.label, "Snapshot -i");
    assert.equal(parsed?.target, undefined);
  });

  it("parses get url observation", () => {
    const parsed = parseAgentBrowserAction("agent-browser get url");
    assert.equal(parsed?.category, "observation");
    assert.equal(parsed?.label, "Get url");
  });

  it("parses open navigation", () => {
    const parsed = parseAgentBrowserAction(
      'agent-browser open "https://example.com"',
    );
    assert.equal(parsed?.category, "navigation");
    assert.equal(parsed?.label, "Open https://example.com");
  });

  it("uses first relevant segment in chained bash", () => {
    const parsed = parseAgentBrowserAction(
      "agent-browser snapshot -i && agent-browser get url",
    );
    assert.equal(parsed?.category, "observation");
    assert.equal(parsed?.subcommand, "snapshot");
  });

  it("returns null for ignored commands", () => {
    assert.equal(parseAgentBrowserAction("agent-browser close"), null);
    assert.equal(parseAgentBrowserAction("agent-browser wait --load networkidle"), null);
    assert.equal(parseAgentBrowserAction("ls -la"), null);
  });

  it("skips leading --headed flag", () => {
    const parsed = parseAgentBrowserAction("agent-browser --headed click @e1");
    assert.equal(parsed?.subcommand, "click");
    assert.equal(parsed?.target, "@e1");
  });
});

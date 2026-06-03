import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBrowserEnv } from "./bash.js";

describe("buildBrowserEnv", () => {
  it("sets AGENT_BROWSER_ENGINE from config", () => {
    const chrome = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      engine: "chrome",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(chrome.AGENT_BROWSER_ENGINE, "chrome");

    const lightpanda = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      engine: "lightpanda",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(lightpanda.AGENT_BROWSER_ENGINE, "lightpanda");
  });

  it("defaults AGENT_BROWSER_ENGINE to chrome", () => {
    const env = buildBrowserEnv({
      headed: false,
      sessionName: "pqa",
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.AGENT_BROWSER_ENGINE, "chrome");
  });
});

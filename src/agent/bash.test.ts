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

  it("applies lightpanda config when engine is lightpanda", () => {
    const cwd = "/project";
    const env = buildBrowserEnv({
      cwd,
      headed: false,
      sessionName: "pqa",
      engine: "lightpanda",
      lightpanda: {
        executablePath: "/opt/lightpanda",
        telemetry: false,
      },
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.AGENT_BROWSER_ENGINE, "lightpanda");
    assert.equal(env.AGENT_BROWSER_EXECUTABLE_PATH, "/opt/lightpanda");
    assert.equal(env.LIGHTPANDA_DISABLE_TELEMETRY, "true");
  });

  it("does not set lightpanda env for chrome engine", () => {
    const env = buildBrowserEnv({
      cwd: "/project",
      headed: false,
      sessionName: "pqa",
      engine: "chrome",
      lightpanda: { telemetry: false },
      artifactDir: "/tmp/artifacts",
    });
    assert.equal(env.LIGHTPANDA_DISABLE_TELEMETRY, undefined);
  });
});

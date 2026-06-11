import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "./load.js";
import {
  deepSet,
  formatConfigFile,
  keyExistsInReference,
  LOCAL_CONFIG_FILENAME,
  parseConfigValue,
  setConfigValue,
} from "./set.js";

describe("parseConfigValue", () => {
  it("parses booleans and numbers", () => {
    assert.equal(parseConfigValue("true"), true);
    assert.equal(parseConfigValue("false"), false);
    assert.equal(parseConfigValue("25"), 25);
    assert.equal(parseConfigValue("17.321"), 17.321);
  });

  it("parses JSON arrays and quoted strings", () => {
    assert.deepEqual(parseConfigValue('["recorded"]'), ["recorded"]);
    assert.equal(parseConfigValue('"hello"'), "hello");
    assert.equal(parseConfigValue("plain"), "plain");
  });
});

describe("keyExistsInReference", () => {
  const reference = {
    browser: { headed: false, sessionName: "pqa", engine: "chrome" },
    llm: { provider: "anthropic", thinking: { enabled: true } },
    healing: { enabled: true, maxRecoveryTurns: 2 },
  };

  it("accepts existing nested keys", () => {
    assert.equal(keyExistsInReference(["browser", "headed"], reference), true);
    assert.equal(keyExistsInReference(["llm", "thinking", "enabled"], reference), true);
    assert.equal(keyExistsInReference(["healing", "maxRecoveryTurns"], reference), true);
  });

  it("rejects unknown keys", () => {
    assert.equal(keyExistsInReference(["browser", "unknown"], reference), false);
    assert.equal(keyExistsInReference(["healing", "unknown"], reference), false);
    assert.equal(keyExistsInReference(["missing"], reference), false);
  });
});

describe("deepSet", () => {
  it("sets nested properties", () => {
    const target: Record<string, unknown> = {};
    deepSet(target, ["browser", "headed"], true);
    assert.deepEqual(target, { browser: { headed: true } });
  });

  it("preserves sibling nested values", () => {
    const target: Record<string, unknown> = { browser: { headed: false } };
    deepSet(target, ["browser", "sessionName"], "custom");
    assert.deepEqual(target, { browser: { headed: false, sessionName: "custom" } });
  });
});

describe("formatConfigFile", () => {
  it("serializes nested objects as JSON", () => {
    const output = formatConfigFile({
      browser: { headed: true, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
    });
    assert.doesNotThrow(() => JSON.parse(output));
    assert.match(output, /"headed": true/);
    assert.match(output, /"defaultTimeout": 25000/);
    assert.doesNotMatch(output, /export default/);
  });
});

describe("setConfigValue", () => {
  it("creates pqa.config.json when missing and writes the value", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-set-"));
    await setConfigValue("browser.headed", "true", cwd);

    const configPath = path.join(cwd, LOCAL_CONFIG_FILENAME);
    assert.equal(existsSync(configPath), true);
    const content = readFileSync(configPath, "utf-8");
    assert.doesNotThrow(() => JSON.parse(content));
    assert.match(content, /"headed": true/);

    const config = await loadConfig(configPath, cwd);
    assert.equal(config.browser.headed, true);
    assert.equal(config.browser.sessionName, "pqa");
  });

  it("merges additional keys into an existing config file", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-set-"));
    writeFileSync(
      path.join(cwd, LOCAL_CONFIG_FILENAME),
      formatConfigFile({
        browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
      }),
    );

    await setConfigValue("browser.headed", "true", cwd);
    await setConfigValue("browser.sessionName", "custom", cwd);

    const content = readFileSync(path.join(cwd, LOCAL_CONFIG_FILENAME), "utf-8");
    assert.match(content, /"headed": true/);
    assert.match(content, /"sessionName": "custom"/);
  });

  it("rejects unknown config keys", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-set-"));
    await assert.rejects(
      () => setConfigValue("browser.unknown", "true", cwd),
      /Unknown config key "browser.unknown"/,
    );
  });

  it("accepts scenariosDir", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "pqa-config-set-"));
    await setConfigValue("scenariosDir", "test", cwd);

    const content = readFileSync(path.join(cwd, LOCAL_CONFIG_FILENAME), "utf-8");
    assert.match(content, /"scenariosDir": "test"/);

    const config = await loadConfig(path.join(cwd, LOCAL_CONFIG_FILENAME), cwd);
    assert.equal(config.scenariosDir, "test");
  });
});

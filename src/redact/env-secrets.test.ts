import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PQA_LLM_API_KEY, resolveSensitiveEnvVars } from "../config/load.js";
import type { PqaConfig } from "../types/config.js";
import { createEnvRedactor } from "./env-secrets.js";

const baseConfig: PqaConfig = {
  llm: { provider: "fireworks", model: "test" },
  browser: { headed: false, sessionName: "pqa", defaultTimeout: 25_000, engine: "chrome" },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
};

describe("createEnvRedactor", () => {
  it("replaces sensitive values with ${VAR} placeholders", () => {
    const redactor = createEnvRedactor(
      { PQA_TEST_PASSWORD: "hunter2" },
      ["PQA_TEST_PASSWORD"],
    );
    assert.equal(
      redactor.redact('typed "hunter2" into the field'),
      'typed "${PQA_TEST_PASSWORD}" into the field',
    );
  });

  it("ignores variables not in sensitiveNames", () => {
    const redactor = createEnvRedactor(
      { PATH: "/usr/bin:/bin", PQA_TEST_PASSWORD: "secret" },
      ["PQA_TEST_PASSWORD"],
    );
    assert.equal(redactor.redact("/usr/bin:/bin"), "/usr/bin:/bin");
  });

  it("uses alphabetically first name when two vars share a value", () => {
    const redactor = createEnvRedactor(
      { VAR_A: "same", VAR_B: "same" },
      ["VAR_B", "VAR_A"],
    );
    assert.equal(redactor.redact("value is same"), "value is ${VAR_A}");
  });

  it("replaces longer values before shorter substrings", () => {
    const redactor = createEnvRedactor(
      { LONG: "long-secret", SHORT: "secret" },
      ["LONG", "SHORT"],
    );
    assert.equal(redactor.redact("long-secret"), "${LONG}");
  });

  it("ignores values shorter than minRedactLength", () => {
    const redactor = createEnvRedactor(
      { FLAG: "yes" },
      ["FLAG"],
      { minRedactLength: 4 },
    );
    assert.equal(redactor.redact("yes"), "yes");
  });

  it("is a no-op when sensitiveNames is empty", () => {
    const redactor = createEnvRedactor({ SECRET: "hidden" }, []);
    assert.equal(redactor.redact("hidden"), "hidden");
  });

  it("redacts bash entries and verdict fields", () => {
    const redactor = createEnvRedactor(
      { PQA_TEST_PASSWORD: "hunter2" },
      ["PQA_TEST_PASSWORD"],
    );
    const entry = redactor.redactBashEntry({
      command: 'agent-browser type "hunter2"',
      stdout: "typed hunter2",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    });
    assert.equal(entry.command, 'agent-browser type "${PQA_TEST_PASSWORD}"');
    assert.equal(entry.stdout, "typed ${PQA_TEST_PASSWORD}");

    const verdict = redactor.redactVerdict({
      status: "pass",
      summary: "password hunter2 accepted",
      checkpoints: [
        {
          assertion: "login",
          pass: true,
          reason: "saw hunter2",
          evidence: ["field value: hunter2"],
        },
      ],
    });
    assert.equal(verdict?.summary, "password ${PQA_TEST_PASSWORD} accepted");
    assert.equal(verdict?.checkpoints[0]?.reason, "saw ${PQA_TEST_PASSWORD}");
    assert.equal(
      verdict?.checkpoints[0]?.evidence?.[0],
      "field value: ${PQA_TEST_PASSWORD}",
    );
  });

  it("does not mutate the source transcript", () => {
    const redactor = createEnvRedactor(
      { PQA_TEST_PASSWORD: "hunter2" },
      ["PQA_TEST_PASSWORD"],
    );
    const transcript = {
      entries: [{ type: "message" as const, role: "assistant", content: "hunter2", at: "2026-01-01T00:00:00.000Z" }],
    };
    const redacted = redactor.redactTranscript(transcript);
    assert.equal(
      transcript.entries[0]!.type === "message" ? transcript.entries[0]!.content : "",
      "hunter2",
    );
    assert.equal(
      redacted.entries[0]!.type === "message" ? redacted.entries[0]!.content : "",
      "${PQA_TEST_PASSWORD}",
    );
  });
});

describe("resolveSensitiveEnvVars", () => {
  it("falls back to envVars when sensitiveEnvVars is omitted", () => {
    const names = resolveSensitiveEnvVars({
      ...baseConfig,
      envVars: ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
    });
    assert.deepEqual(names, [
      PQA_LLM_API_KEY,
      "PQA_TEST_EMAIL",
      "PQA_TEST_PASSWORD",
    ]);
  });

  it("uses sensitiveEnvVars when provided", () => {
    const names = resolveSensitiveEnvVars({
      ...baseConfig,
      envVars: ["PQA_TEST_EMAIL"],
      sensitiveEnvVars: ["PQA_TEST_PASSWORD"],
    });
    assert.deepEqual(names, [PQA_LLM_API_KEY, "PQA_TEST_PASSWORD"]);
  });

  it("omits LLM API key env var for ollama", () => {
    const names = resolveSensitiveEnvVars({
      ...baseConfig,
      llm: { provider: "ollama", model: "llama3.2" },
      envVars: ["PQA_TEST_PASSWORD"],
    });
    assert.deepEqual(names, ["PQA_TEST_PASSWORD"]);
  });
});

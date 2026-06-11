import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkBashResult,
  BrowserHealthError,
} from "./browser-health.js";

describe("checkBashResult", () => {
  it("returns null for successful commands", () => {
    const result = checkBashResult({
      command: "agent-browser snapshot",
      stdout: "<html>...</html>",
      stderr: "",
      exitCode: 0,
      durationMs: 100,
    });
    assert.equal(result, null);
  });

  it("returns null for non-browser commands with non-zero exit", () => {
    const result = checkBashResult({
      command: "ls /nonexistent",
      stdout: "",
      stderr: "ls: /nonexistent: No such file or directory",
      exitCode: 1,
      durationMs: 10,
    });
    assert.equal(result, null);
  });

  it("returns null for non-browser commands with zero exit", () => {
    const result = checkBashResult({
      command: "echo hello",
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
    });
    assert.equal(result, null);
  });

  it("detects agent-browser command not found", () => {
    const result = checkBashResult({
      command: "agent-browser open",
      stdout: "",
      stderr: "bash: agent-browser: command not found",
      exitCode: 127,
      durationMs: 10,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "agent_browser_missing");
    assert.equal(result!.fatal, true);
    assert.match(result!.message, /not installed/);
    assert.match(result!.hint, /npm install/);
  });

  it("detects agent-browser not found via alternative wording", () => {
    const result = checkBashResult({
      command: "agent-browser open",
      stdout: "",
      stderr: "Error: Cannot find the command agent-browser",
      exitCode: 1,
      durationMs: 10,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "agent_browser_missing");
  });

  it("detects DNS resolution failure", () => {
    const result = checkBashResult({
      command: "agent-browser open https://nonexistent.example.com",
      stdout: "",
      stderr: "Error: getaddrinfo ENOTFOUND nonexistent.example.com",
      exitCode: 1,
      durationMs: 500,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "dns_resolution");
    assert.equal(result!.fatal, true);
    assert.match(result!.message, /DNS/);
  });

  it("detects ERR_NAME_NOT_RESOLVED", () => {
    const result = checkBashResult({
      command: "agent-browser open https://bad.example.com",
      stdout: "",
      stderr: "Error: ERR_NAME_NOT_RESOLVED bad.example.com",
      exitCode: 1,
      durationMs: 500,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "dns_resolution");
  });

  it("detects SSL certificate error", () => {
    const result = checkBashResult({
      command: "curl https://expired.badssl.com",
      stdout: "",
      stderr: "curl: (60) SSL certificate problem: certificate has expired",
      exitCode: 60,
      durationMs: 200,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "ssl_tls_error");
    assert.equal(result!.fatal, true);
  });

  it("detects Chrome not found", () => {
    const result = checkBashResult({
      command: "agent-browser open https://example.com",
      stdout: "",
      stderr:
        "Error: Cannot find Chrome executable. Install Google Chrome or set CHROME_PATH.",
      exitCode: 1,
      durationMs: 50,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "chrome_missing");
    assert.equal(result!.fatal, true);
  });

  it("detects Chrome not found via ENOENT", () => {
    const result = checkBashResult({
      command: "agent-browser open https://example.com",
      stdout: "",
      stderr: "Error: spawn /usr/bin/google-chrome ENOENT",
      exitCode: 1,
      durationMs: 50,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "chrome_missing");
  });

  it("detects connection refused", () => {
    const result = checkBashResult({
      command: "agent-browser open http://localhost:9999",
      stdout: "",
      stderr: "Error: connect ECONNREFUSED ::1:9999",
      exitCode: 1,
      durationMs: 100,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "connection_refused");
    assert.equal(result!.fatal, true);
  });

  it("detects connection timeout", () => {
    const result = checkBashResult({
      command: "agent-browser open http://slow.example.com",
      stdout: "",
      stderr: "Error: ETIMEDOUT slow.example.com:80",
      exitCode: 1,
      durationMs: 30000,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "connection_timeout");
    assert.equal(result!.fatal, true);
  });

  it("detects permission denied", () => {
    const result = checkBashResult({
      command: "agent-browser open about:blank",
      stdout: "",
      stderr: "Error: EACCES: permission denied, open '/var/chrome/sandbox'",
      exitCode: 1,
      durationMs: 20,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "permission_denied");
    assert.equal(result!.fatal, true);
  });

  it("detects disk space", () => {
    const result = checkBashResult({
      command: "agent-browser screenshot",
      stdout: "",
      stderr: "Error: ENOSPC: no space left on device, write",
      exitCode: 1,
      durationMs: 100,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "disk_space");
    assert.equal(result!.fatal, true);
  });

  it("detects port conflict", () => {
    const result = checkBashResult({
      command: "agent-browser open http://localhost:9222",
      stdout: "",
      stderr: "Error: listen EADDRINUSE: address already in use :::9222",
      exitCode: 1,
      durationMs: 20,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "port_conflict");
    assert.equal(result!.fatal, false);
  });

  it("detects unknown engine version mismatch", () => {
    const result = checkBashResult({
      command: "agent-browser open about:blank",
      stdout: "",
      stderr: "Error: Unknown engine: lightpanda",
      exitCode: 1,
      durationMs: 20,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "version_mismatch");
    assert.equal(result!.fatal, true);
  });

  it("detects Lightpanda not found", () => {
    const result = checkBashResult({
      command: "agent-browser open about:blank",
      stdout: "",
      stderr: "Error: lightpanda: command not found",
      exitCode: 127,
      durationMs: 20,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "lightpanda_missing");
    assert.equal(result!.fatal, true);
  });

  it("falls back to unknown_browser_error for unmatched agent-browser failures", () => {
    const result = checkBashResult({
      command: "agent-browser open about:blank",
      stdout: "",
      stderr: "Some weird error we do not have a pattern for",
      exitCode: 1,
      durationMs: 50,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "unknown_browser_error");
    assert.equal(result!.fatal, false);
    assert.match(result!.message, /exit code 1/);
  });

  it("returns null for unmatched non-agent-browser commands", () => {
    const result = checkBashResult({
      command: "git push",
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
      durationMs: 50,
    });
    assert.equal(result, null);
  });
});

describe("BrowserHealthError", () => {
  it("formats a readable error message with category, hint and excerpt", () => {
    const issue = checkBashResult({
      command: "agent-browser open",
      stdout: "",
      stderr: "bash: agent-browser: command not found",
      exitCode: 127,
      durationMs: 10,
    });
    assert.notEqual(issue, null);
    const error = new BrowserHealthError(issue!);
    assert.match(error.message, /AGENT_BROWSER_MISSING/);
    assert.match(error.message, /agent-browser is not installed/);
    assert.match(error.message, /npm install/);
    assert.match(error.message, /command not found/);
    assert.equal(error.issue.category, "agent_browser_missing");
    assert.equal(error.name, "BrowserHealthError");
  });
});

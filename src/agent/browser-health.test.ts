import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoDoomedRun,
  buildFailureFingerprint,
  checkBashResult,
  checkUrlForBrowserError,
  detectRepeatedFailure,
  BrowserHealthError,
  parseBrowserHealthCategoryFromError,
} from "./browser-health.js";
import type { AgentTranscript } from "../types/verdict.js";

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

  it("falls back to fatal unknown_browser_error for critical open failures", () => {
    const result = checkBashResult({
      command: "agent-browser open about:blank",
      stdout: "",
      stderr: "Some weird error we do not have a pattern for",
      exitCode: 1,
      durationMs: 50,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "unknown_browser_error");
    assert.equal(result!.fatal, true);
    assert.match(result!.message, /exit code 1/);
  });

  it("falls back to non-fatal unknown_browser_error for click failures", () => {
    const result = checkBashResult({
      command: "agent-browser click @e1",
      stdout: "",
      stderr: "Some weird error we do not have a pattern for",
      exitCode: 1,
      durationMs: 50,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "unknown_browser_error");
    assert.equal(result!.fatal, false);
  });

  it("detects browser session closed", () => {
    const result = checkBashResult({
      command: "agent-browser click @e1",
      stdout: "",
      stderr: "Error: Target page, context or browser has been closed",
      exitCode: 1,
      durationMs: 10,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "browser_closed");
    assert.equal(result!.fatal, true);
  });

  it("detects connection reset", () => {
    const result = checkBashResult({
      command: "agent-browser open https://example.com",
      stdout: "",
      stderr: "Error: ERR_CONNECTION_RESET",
      exitCode: 1,
      durationMs: 10,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "connection_reset");
    assert.equal(result!.fatal, true);
  });

  it("detects network offline", () => {
    const result = checkBashResult({
      command: "agent-browser open https://example.com",
      stdout: "",
      stderr: "Error: ERR_INTERNET_DISCONNECTED",
      exitCode: 1,
      durationMs: 10,
    });
    assert.notEqual(result, null);
    assert.equal(result!.category, "network_offline");
    assert.equal(result!.fatal, true);
  });

  it("detects chrome error page in output", () => {
    const result = checkBashResult({
      command: "agent-browser get url",
      stdout: "chrome-error://dnserror/",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
    });
    assert.equal(result, null);
    const urlIssue = checkUrlForBrowserError("chrome-error://dnserror/");
    assert.notEqual(urlIssue, null);
    assert.equal(urlIssue!.category, "chrome_error_page");
    assert.equal(urlIssue!.fatal, true);
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

describe("buildFailureFingerprint", () => {
  it("normalizes refs and stderr for stable matching", () => {
    const a = buildFailureFingerprint({
      command: "agent-browser click @e1",
      stdout: "",
      stderr: "Element  not   found",
      exitCode: 1,
      durationMs: 1,
    });
    const b = buildFailureFingerprint({
      command: "agent-browser click @e99",
      stdout: "",
      stderr: "Element not found",
      exitCode: 1,
      durationMs: 1,
    });
    assert.equal(a, b);
  });
});

describe("detectRepeatedFailure", () => {
  const failedEntry = {
    command: "agent-browser click @e1",
    stdout: "",
    stderr: "Element not found",
    exitCode: 1,
    durationMs: 1,
  };

  it("returns null before threshold is reached", () => {
    assert.equal(detectRepeatedFailure([failedEntry, failedEntry], 3), null);
  });

  it("returns repeated_failure at threshold", () => {
    const issue = detectRepeatedFailure(
      [failedEntry, failedEntry, failedEntry],
      3,
    );
    assert.notEqual(issue, null);
    assert.equal(issue!.category, "repeated_failure");
    assert.equal(issue!.fatal, true);
  });
});

describe("parseBrowserHealthCategoryFromError", () => {
  it("parses infrastructure categories from BrowserHealthError messages", () => {
    const error = new BrowserHealthError({
      category: "connection_timeout",
      severity: "error",
      fatal: true,
      message: "Connection timed out",
      excerpt: "ETIMEDOUT",
      hint: "retry later",
    });
    assert.equal(
      parseBrowserHealthCategoryFromError(error.message),
      "connection_timeout",
    );
  });
});

describe("assertNoDoomedRun", () => {
  it("throws when repeated failures are present in the transcript", () => {
    const transcript: AgentTranscript = {
      entries: [
        {
          type: "bash",
          command: "agent-browser click @e1",
          stdout: "",
          stderr: "fail",
          exitCode: 1,
          durationMs: 1,
          at: "2026-01-01T00:00:00.000Z",
        },
        {
          type: "bash",
          command: "agent-browser click @e2",
          stdout: "",
          stderr: "fail",
          exitCode: 1,
          durationMs: 1,
          at: "2026-01-01T00:00:01.000Z",
        },
        {
          type: "bash",
          command: "agent-browser click @e3",
          stdout: "",
          stderr: "fail",
          exitCode: 1,
          durationMs: 1,
          at: "2026-01-01T00:00:02.000Z",
        },
      ],
    };

    assert.throws(
      () =>
        assertNoDoomedRun(transcript, {
          llm: {},
          browser: {
            headed: false,
            sessionName: "pqa",
            defaultTimeout: 25_000,
            engine: "chrome",
          },
          skills: { dirs: [], preloads: [] },
          agent: { maxTurns: 10, bashTimeoutMs: 60_000 },
          browserHealth: { circuitBreakerThreshold: 3 },
        }),
      BrowserHealthError,
    );
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

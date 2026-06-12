import type { BashEntry } from "../types/verdict.js";
import type { PqaConfig } from "../types/config.js";
import { resolveBrowserHealthConfig } from "../config/load.js";
import { getTranscriptBashEntries } from "./verdict.js";
import type { AgentTranscript } from "../types/verdict.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BrowserHealthCategory =
  | "agent_browser_missing"
  | "chrome_missing"
  | "lightpanda_missing"
  | "dns_resolution"
  | "connection_refused"
  | "connection_timeout"
  | "connection_reset"
  | "network_offline"
  | "ssl_tls_error"
  | "port_conflict"
  | "permission_denied"
  | "disk_space"
  | "version_mismatch"
  | "browser_closed"
  | "chrome_error_page"
  | "repeated_failure"
  | "unknown_browser_error";

export type Severity = "error" | "warn" | "info";

export interface BrowserHealthIssue {
  category: BrowserHealthCategory;
  severity: Severity;
  fatal: boolean;
  message: string;
  excerpt: string;
  hint: string;
}

interface Rule {
  category: BrowserHealthCategory;
  severity: Severity;
  fatal: boolean;
  patterns: RegExp[];
  buildMessage: (excerpt: string) => string;
  buildHint: () => string;
}

/** Categories treated as non-recoverable infrastructure failures. */
export const INFRASTRUCTURE_CATEGORIES: readonly BrowserHealthCategory[] = [
  "agent_browser_missing",
  "chrome_missing",
  "lightpanda_missing",
  "dns_resolution",
  "connection_refused",
  "connection_timeout",
  "connection_reset",
  "network_offline",
  "ssl_tls_error",
  "permission_denied",
  "disk_space",
  "version_mismatch",
  "browser_closed",
  "chrome_error_page",
  "repeated_failure",
] as const;

const BROWSER_HEALTH_ERROR_RE = /\[([A-Z_]+)\]/;

// ─── Error class ─────────────────────────────────────────────────────────────

export class BrowserHealthError extends Error {
  override name = "BrowserHealthError";
  issue: BrowserHealthIssue;
  constructor(issue: BrowserHealthIssue) {
    super(
      `[${issue.category.toUpperCase()}] ${issue.message}\n` +
        `Hint: ${issue.hint}\n` +
        `Excerpt: ${issue.excerpt}`,
    );
    this.issue = issue;
  }
}

// ─── Rules ───────────────────────────────────────────────────────────────────

const RULES: Rule[] = [
  // ── agent-browser not installed ──────────────────────────────────────────
  {
    category: "agent_browser_missing",
    severity: "error",
    fatal: true,
    patterns: [
      /agent-browser:\s*(command\s+)?not\s+found/i,
      /cannot\s+find\s+(the\s+)?(command|program|binary)\s+agent-browser/i,
      /agent-browser.*(no such file|not found)/i,
    ],
    buildMessage: () => `agent-browser is not installed or not on $PATH.`,
    buildHint: () =>
      `Run: npm install -g agent-browser or npx agent-browser (for local install). ` +
      `See https://github.com/mariozechner/agent-browser#installation`,
  },

  // ── Chrome/Chromium not found ────────────────────────────────────────────
  {
    category: "chrome_missing",
    severity: "error",
    fatal: true,
    patterns: [
      /(not found|cannot find|command not found).*(google-chrome|chromium|chrome)/i,
      /(google-chrome|chromium|chrome).*(not found|command not found|cannot find|not installed)/i,
      /(google-chrome|chromium|chrome).*ENOENT/i,
      /(ENOENT|No such file).*(google-chrome|chromium|chrome)/i,
      /chrome.*executable.*(doesn't exist|missing|not found)/i,
    ],
    buildMessage: () => `Chrome or Chromium is not installed on this system.`,
    buildHint: () =>
      `Install Google Chrome or Chromium. On macOS: brew install --cask google-chrome. ` +
      `On Ubuntu: sudo apt install google-chrome-stable. ` +
      `Set CHROME_PATH or CHROMIUM_PATH env vars if installed in a custom location.`,
  },

  // ── Lightpanda not found ─────────────────────────────────────────────────
  {
    category: "lightpanda_missing",
    severity: "error",
    fatal: true,
    patterns: [
      /lightpanda.*(not found|command not found|cannot find)/i,
      /lightpanda.*(ENOENT|No such file)/i,
      /engine.*lightpanda.*(not found|not available)/i,
    ],
    buildMessage: () => `Lightpanda browser engine is not installed or not found.`,
    buildHint: () =>
      `Install Lightpanda via pip: pip install lightpanda, or download from lightpanda.com. ` +
      `Check pqa.config.ts → browser.lightpanda.executablePath.`,
  },

  // ── Browser / session closed ─────────────────────────────────────────────
  {
    category: "browser_closed",
    severity: "error",
    fatal: true,
    patterns: [
      /target page, context or browser has been closed/i,
      /browser has been closed/i,
      /session closed/i,
    ],
    buildMessage: () => `Browser session is closed — cannot continue UI interactions.`,
    buildHint: () =>
      `Restart the scenario. Check for crashes, OOM, or premature agent-browser close.`,
  },

  // ── Chrome error page ────────────────────────────────────────────────────
  {
    category: "chrome_error_page",
    severity: "error",
    fatal: true,
    patterns: [
      /chrome-error:\/\//i,
      /about:neterror/i,
    ],
    buildMessage: () => `Browser is showing a network error page.`,
    buildHint: () =>
      `Verify the target URL is reachable and returns a valid response.`,
  },

  // ── DNS resolution errors ────────────────────────────────────────────────
  {
    category: "dns_resolution",
    severity: "error",
    fatal: true,
    patterns: [
      /ENOTFOUND/i,
      /getaddrinfo.*(not found|enotfound)/i,
      /dns.*(error|resolution error|not resolved)/i,
      /name or service not known/i,
      /ERR_NAME_NOT_RESOLVED/i,
    ],
    buildMessage: () => `DNS resolution failed — the domain name could not be resolved.`,
    buildHint: () =>
      `Check your network connection and DNS settings. Verify the URL is correct. ` +
      `Try: curl -I <url> to confirm reachability.`,
  },

  // ── Connection refused ───────────────────────────────────────────────────
  {
    category: "connection_refused",
    severity: "error",
    fatal: true,
    patterns: [
      /ECONNREFUSED/i,
      /connection refused/i,
      /ERR_CONNECTION_REFUSED/i,
      /connect.*refused/i,
    ],
    buildMessage: () => `Connection refused — the server is not accepting connections.`,
    buildHint: () =>
      `Ensure the target server is running and reachable. ` +
      `Check firewalls, VPN, and port mappings.`,
  },

  // ── Connection timeout ───────────────────────────────────────────────────
  {
    category: "connection_timeout",
    severity: "error",
    fatal: true,
    patterns: [
      /ETIMEDOUT/i,
      /connection.*(timed out|timeout)/i,
      /ERR_CONNECTION_TIMED_OUT/i,
      /timeout.*(exceeded|reached)/i,
    ],
    buildMessage: () => `Connection timed out — the server did not respond in time.`,
    buildHint: () =>
      `Check network connectivity. The server may be slow, overloaded, or blocking requests. ` +
      `Try increasing browser.timeout in pqa.config.ts.`,
  },

  // ── Connection reset ─────────────────────────────────────────────────────
  {
    category: "connection_reset",
    severity: "error",
    fatal: true,
    patterns: [
      /ERR_CONNECTION_RESET/i,
      /ECONNRESET/i,
      /connection reset/i,
    ],
    buildMessage: () => `Connection reset — the server closed the connection unexpectedly.`,
    buildHint: () =>
      `Check server stability and network proxies. Retry when the service is healthy.`,
  },

  // ── Network offline ──────────────────────────────────────────────────────
  {
    category: "network_offline",
    severity: "error",
    fatal: true,
    patterns: [
      /ERR_INTERNET_DISCONNECTED/i,
      /ERR_NETWORK_CHANGED/i,
      /network.*offline/i,
    ],
    buildMessage: () => `Network is offline or unavailable.`,
    buildHint: () =>
      `Restore network connectivity before re-running the scenario.`,
  },

  // ── SSL/TLS errors ────────────────────────────────────────────────────────
  {
    category: "ssl_tls_error",
    severity: "error",
    fatal: true,
    patterns: [
      /ERR_CERT_AUTHORITY_INVALID/i,
      /ERR_CERT_COMMON_NAME_INVALID/i,
      /ERR_CERT_DATE_INVALID/i,
      /UNABLE_TO_VERIFY_LEAF_SIGNATURE/i,
      /CERT_UNTRUSTED/i,
      /SELF_SIGNED_CERT_IN_CHAIN/i,
      /DEPTH_ZERO_SELF_SIGNED_CERT/i,
      /certificate.*(expired|invalid|untrusted|self.signed)/i,
      /ssl.*error/i,
      /tls.*error/i,
    ],
    buildMessage: () =>
      `SSL/TLS certificate error — the server certificate is invalid or untrusted.`,
    buildHint: () =>
      `Check the server's SSL configuration. For local/staging servers with self-signed certs, ` +
      `set NODE_TLS_REJECT_UNAUTHORIZED=0 (not recommended for production) or add the cert ` +
      `to the system trust store.`,
  },

  // ── Port conflict ────────────────────────────────────────────────────────
  {
    category: "port_conflict",
    severity: "error",
    fatal: false,
    patterns: [
      /EADDRINUSE/i,
      /address already in use/i,
      /port.*already in use/i,
    ],
    buildMessage: () => `Port conflict — the required port is already in use.`,
    buildHint: () =>
      `Kill the process using the port: lsof -ti:<port> | xargs kill -9, ` +
      `or configure a different port.`,
  },

  // ── Permission denied ────────────────────────────────────────────────────
  {
    category: "permission_denied",
    severity: "error",
    fatal: true,
    patterns: [
      /EACCES/i,
      /EPERM/i,
      /permission denied/i,
      /operation not permitted/i,
    ],
    buildMessage: () => `Permission denied — the process lacks the required permissions.`,
    buildHint: () =>
      `Check file/directory permissions. The browser binary may need execute permissions ` +
      `(chmod +x). Avoid running as root unless necessary.`,
  },

  // ── Disk space ────────────────────────────────────────────────────────────
  {
    category: "disk_space",
    severity: "error",
    fatal: true,
    patterns: [
      /ENOSPC/i,
      /no space left on device/i,
      /disk quota exceeded/i,
    ],
    buildMessage: () => `No space left on device — the disk is full.`,
    buildHint: () =>
      `Free up disk space: docker system prune, rm -rf node_modules, clean ~/.cache.`,
  },

  // ── Version mismatch / unknown engine ─────────────────────────────────────
  {
    category: "version_mismatch",
    severity: "error",
    fatal: true,
    patterns: [
      /unknown engine/i,
      /unsupported (engine|browser|version)/i,
      /version.*(mismatch|incompatible|not supported)/i,
      /agent-browser.*update.*required/i,
    ],
    buildMessage: () =>
      `Version mismatch — agent-browser or browser engine version is incompatible.`,
    buildHint: () =>
      `Update agent-browser and ensure your browser engine matches the expected version. ` +
      `Run: npm update -g agent-browser. Check AGENT_BROWSER_ENGINE config.`,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeStderrExcerpt(stderr: string): string {
  return stderr.slice(0, 120).trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCommand(command: string): string {
  return command
    .trim()
    .toLowerCase()
    .replace(/@e\d+/g, "@eN");
}

export function buildFailureFingerprint(entry: BashEntry): string {
  return [
    normalizeCommand(entry.command),
    String(entry.exitCode),
    normalizeStderrExcerpt(entry.stderr),
  ].join("|");
}

function isAgentBrowserFailure(entry: BashEntry): boolean {
  return entry.command.includes("agent-browser") && entry.exitCode !== 0;
}

function hasRepeatedFingerprints(fingerprints: string[], threshold: number): boolean {
  if (fingerprints.length < threshold || threshold < 2) return false;
  const recent = fingerprints.slice(-threshold);
  const first = recent[0];
  return recent.every((fp) => fp === first);
}

export function isCriticalBrowserCommand(command: string): boolean {
  return /\bagent-browser\s+(open|navigate)\b/i.test(command);
}

export function isOpenBrowserCommand(command: string): boolean {
  return /\bagent-browser\s+open\b/i.test(command);
}

export function parseBrowserHealthCategoryFromError(
  error: string,
): BrowserHealthCategory | null {
  const match = error.match(BROWSER_HEALTH_ERROR_RE);
  if (!match) return null;
  const category = match[1]!.toLowerCase() as BrowserHealthCategory;
  if ((INFRASTRUCTURE_CATEGORIES as readonly string[]).includes(category)) {
    return category;
  }
  return null;
}

export function isInfrastructureCategory(
  category: BrowserHealthCategory,
): boolean {
  return (INFRASTRUCTURE_CATEGORIES as readonly string[]).includes(category);
}

function matchRules(blob: string): BrowserHealthIssue | null {
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = blob.match(pattern);
      if (match) {
        return {
          category: rule.category,
          severity: rule.severity,
          fatal: rule.fatal,
          message: rule.buildMessage(match[0]),
          excerpt: match[0],
          hint: rule.buildHint(),
        };
      }
    }
  }
  return null;
}

function buildRepeatedFailureIssue(fingerprint: string): BrowserHealthIssue {
  return {
    category: "repeated_failure",
    severity: "error",
    fatal: true,
    message: `The same agent-browser command failed repeatedly — aborting to avoid wasted turns.`,
    excerpt: fingerprint.slice(0, 120),
    hint: `Fix the underlying browser or UI issue before retrying. Check stderr in the transcript.`,
  };
}

/**
 * Detect when the last N agent-browser failures share the same fingerprint.
 */
export function detectRepeatedFailure(
  entries: BashEntry[],
  threshold: number,
): BrowserHealthIssue | null {
  if (threshold < 2) return null;

  const fingerprints = entries
    .filter(isAgentBrowserFailure)
    .map(buildFailureFingerprint);

  if (!hasRepeatedFingerprints(fingerprints, threshold)) return null;
  return buildRepeatedFailureIssue(fingerprints[fingerprints.length - 1]!);
}

/**
 * Inspect a URL returned by `agent-browser get url` for error pages.
 */
export function checkUrlForBrowserError(
  url: string,
  expectedStartUrl?: string,
): BrowserHealthIssue | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const blob = trimmed;
  const fromRules = matchRules(blob);
  if (fromRules) return fromRules;

  if (
    trimmed === "about:blank" &&
    expectedStartUrl &&
    expectedStartUrl !== "about:blank"
  ) {
    return {
      category: "chrome_error_page",
      severity: "error",
      fatal: true,
      message: `Navigation did not reach the expected page (still on about:blank).`,
      excerpt: trimmed,
      hint: `Verify the open URL is valid and the server is reachable.`,
    };
  }

  return null;
}

function collectFailureFingerprints(
  transcript: AgentTranscript,
  withinTurnFingerprints: string[],
  currentEntry?: BashEntry,
): string[] {
  const historical = getTranscriptBashEntries(transcript)
    .filter(isAgentBrowserFailure)
    .map(buildFailureFingerprint);

  const combined = [...historical, ...withinTurnFingerprints];
  if (currentEntry && isAgentBrowserFailure(currentEntry)) {
    const fp = buildFailureFingerprint(currentEntry);
    if (combined[combined.length - 1] !== fp) {
      combined.push(fp);
    }
  }
  return combined;
}

/**
 * Throw when the transcript shows an unrecoverable browser failure pattern.
 */
export function assertNoDoomedRun(
  transcript: AgentTranscript,
  config: PqaConfig,
  withinTurnFingerprints: string[] = [],
): void {
  const threshold = resolveBrowserHealthConfig(config).circuitBreakerThreshold;
  const fingerprints = collectFailureFingerprints(
    transcript,
    withinTurnFingerprints,
  );

  if (hasRepeatedFingerprints(fingerprints, threshold)) {
    throw new BrowserHealthError(
      buildRepeatedFailureIssue(fingerprints[fingerprints.length - 1]!),
    );
  }

  const failedEntries = getTranscriptBashEntries(transcript).filter(
    isAgentBrowserFailure,
  );
  const lastFailed = failedEntries[failedEntries.length - 1];
  if (lastFailed) {
    const issue = checkBashResult(lastFailed);
    if (issue?.fatal) {
      throw new BrowserHealthError(issue);
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Inspect a BashEntry for known browser-related issues.
 * Returns a `BrowserHealthIssue` if a known problem is detected, or `null`
 * if the result looks healthy (w.r.t. browser tooling).
 *
 * Designed to be called *immediately* after `runBash()`, before forwarding
 * the result to the LLM.
 */
export function checkBashResult(entry: BashEntry): BrowserHealthIssue | null {
  const { exitCode, stderr, stdout, command } = entry;

  // Only inspect commands involving browser tooling.
  if (
    !command.includes("agent-browser") &&
    !command.includes("chrome") &&
    !command.includes("chromium") &&
    !command.includes("google-chrome") &&
    !command.includes("lightpanda") &&
    !command.includes("curl") &&
    exitCode === 0
  ) {
    return null;
  }

  // Exit code 0 → success, skip (agent-browser often prints progress to stderr).
  if (exitCode === 0) return null;

  const blob = `${stderr}\n${stdout}`;
  const matched = matchRules(blob);
  if (matched) return matched;

  // Generic catch-all for agent-browser commands that fail with a non-zero
  // exit code but no known pattern.
  if (command.includes("agent-browser") && exitCode !== 0) {
    const fatal = isCriticalBrowserCommand(command);
    return {
      category: "unknown_browser_error",
      severity: "error",
      fatal,
      message: `agent-browser command failed with exit code ${exitCode}.`,
      excerpt: stderr.slice(0, 200).trim(),
      hint: fatal
        ? `Critical navigation command failed. Check agent-browser installation, URL, and network.`
        : `Review the stderr output above. If this persists, check agent-browser installation and network.`,
    };
  }

  return null;
}

export function evaluateBrowserHealthAfterBash(options: {
  entry: BashEntry;
  transcript: AgentTranscript;
  config: PqaConfig;
  withinTurnFingerprints: string[];
}): BrowserHealthIssue | null {
  const { entry, transcript, config, withinTurnFingerprints } = options;
  const threshold = resolveBrowserHealthConfig(config).circuitBreakerThreshold;

  const issue = checkBashResult(entry);
  if (issue?.fatal) return issue;

  const fingerprints = collectFailureFingerprints(
    transcript,
    withinTurnFingerprints,
    entry,
  );
  if (hasRepeatedFingerprints(fingerprints, threshold)) {
    return buildRepeatedFailureIssue(fingerprints[fingerprints.length - 1]!);
  }

  return null;
}

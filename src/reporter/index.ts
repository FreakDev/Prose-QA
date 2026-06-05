import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunReport, ScenarioResult } from "../types/verdict.js";
import type { EnvRedactor } from "../redact/env-secrets.js";
import { enrichVerdictWithStats, getTranscriptBashEntries } from "../agent/verdict.js";

export function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function ensureRunDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".pqa", "runs", runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function scenarioArtifactDir(runDir: string, scenarioName: string): string {
  const safe = scenarioName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const dir = path.join(runDir, safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeReport(
  runDir: string,
  report: RunReport,
  redactor?: EnvRedactor,
): void {
  const safeResults = redactor
    ? report.results.map((r) => redactor.redactScenarioResult(r))
    : report.results;
  const safeReport = { ...report, results: safeResults };
  writeFileSync(
    path.join(runDir, "report.json"),
    `${JSON.stringify(safeReport, null, 2)}\n`,
  );
  writeFileSync(path.join(runDir, "report.html"), renderHtml(safeReport));
}

export function writeTranscript(
  artifactDir: string,
  transcript: ScenarioResult["transcript"],
  redactor?: EnvRedactor,
): void {
  const safe = redactor ? redactor.redactTranscript(transcript) : transcript;
  writeFileSync(
    path.join(artifactDir, "transcript.json"),
    `${JSON.stringify(safe, null, 2)}\n`,
  );
}

export function writeScenarioTranscript(
  artifactDir: string,
  result: ScenarioResult,
  redactor?: EnvRedactor,
): void {
  const safe = redactor ? redactor.redactScenarioResult(result) : result;
  writeFileSync(
    path.join(artifactDir, "transcript.json"),
    `${JSON.stringify(safe.transcript, null, 2)}\n`,
  );
  if (safe.verdict) {
    const verdict =
      enrichVerdictWithStats(safe.verdict, safe.transcript, {
        durationMs: safe.durationMs,
        healing: safe.healing,
      }) ?? safe.verdict;
    writeFileSync(
      path.join(artifactDir, "verdict.json"),
      `${JSON.stringify(verdict, null, 2)}\n`,
    );
  }
}

function scenarioStatusClass(
  status: ScenarioResult["status"],
): "pass" | "fail" | "error" | "skipped" {
  if (status === "pass") return "pass";
  if (status === "skipped") return "skipped";
  if (status === "fail") return "fail";
  return "error";
}

function formatReportSummaryLine(summary: RunReport["summary"]): string {
  const parts = [`${summary.passed}/${summary.total} passed`];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.errors > 0) parts.push(`${summary.errors} errors`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  return parts.join(", ");
}

function formatDurationMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function renderScenarioSummaryHtml(results: ScenarioResult[]): string {
  if (results.length === 0) {
    return "";
  }
  const items = results
    .map((r) => {
      const statusClass = scenarioStatusClass(r.status);
      return `<li class="${statusClass}"><span class="badge">${r.status}</span> ${escapeHtml(r.scenario)} <span class="duration">${formatDurationMs(r.durationMs)}</span></li>`;
    })
    .join("\n    ");
  return `<section class="summary">
    <h2>Scenarios</h2>
    <ul class="scenario-summary">
    ${items}
    </ul>
  </section>`;
}

function renderHtml(report: RunReport): string {
  const summaryList = renderScenarioSummaryHtml(report.results);
  const rows = report.results
    .map((r) => {
      const statusClass = scenarioStatusClass(r.status);
      const checkpoints =
        r.verdict?.checkpoints
          .map(
            (c) =>
              `<li class="${c.pass ? "pass" : "fail"}">${escapeHtml(c.assertion)}: ${escapeHtml(c.reason)}</li>`,
          )
          .join("") ?? "";
      const bash = getTranscriptBashEntries(r.transcript)
        .slice(-10)
        .map(
          (b) =>
            `<pre><code>$ ${escapeHtml(b.command)}\nexit ${b.exitCode}\n${escapeHtml(b.stdout.slice(0, 500))}</code></pre>`,
        )
        .join("");
      const healingBadge = r.healing?.used
        ? `<span class="badge healed">healed</span>`
        : "";
      const healingDetail = r.healing
        ? `<p class="healing-meta">failure: ${escapeHtml(r.healing.failureKind ?? "—")}; recovery turns: ${r.healing.recoveryTurns}; scenario retries: ${r.healing.scenarioRetries}</p>`
        : "";

      return `<section class="scenario ${statusClass}">
        <h2>${escapeHtml(r.scenario)} <span class="badge">${r.status}</span>${healingBadge}</h2>
        <p>${(r.durationMs / 1000).toFixed(1)}s</p>
        ${healingDetail}
        ${r.error ? `<p class="error">${escapeHtml(r.error)}</p>` : ""}
        ${r.verdict ? `<p>${escapeHtml(r.verdict.summary)}</p>` : ""}
        ${checkpoints ? `<ul>${checkpoints}</ul>` : ""}
        ${bash}
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>PQA Report ${escapeHtml(report.runId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    .pass { color: #059669; }
    .fail, .error { color: #dc2626; }
    .skipped { color: #d97706; }
    .badge { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; background: #e5e7eb; }
    .badge.healed { background: #dbeafe; color: #1d4ed8; }
    .healing-meta { font-size: 0.85rem; color: #6b7280; }
    pre { background: #f3f4f6; padding: 0.75rem; overflow-x: auto; font-size: 0.85rem; }
    summary { margin: 2rem 0 1rem; }
    .scenario-summary { list-style: none; padding: 0; margin: 0 0 2rem; }
    .scenario-summary li { padding: 0.35rem 0; border-bottom: 1px solid #e5e7eb; }
    .scenario-summary .duration { color: #6b7280; font-size: 0.9rem; }
    section.summary h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
  </style>
</head>
<body>
  <h1>PQA Run Report</h1>
  <p>Run ID: ${escapeHtml(report.runId)}</p>
  <p>${formatReportSummaryLine(report.summary)}</p>
  ${summaryList}
  ${rows}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReport(
  runId: string,
  startedAt: Date,
  results: ScenarioResult[],
): RunReport {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      errors,
      skipped,
    },
  };
}

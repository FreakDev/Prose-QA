import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunReport, ScenarioResult } from "../types/verdict.js";

export function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function ensureRunDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".saq", "runs", runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function scenarioArtifactDir(runDir: string, scenarioName: string): string {
  const safe = scenarioName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const dir = path.join(runDir, safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeReport(runDir: string, report: RunReport): void {
  writeFileSync(
    path.join(runDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(path.join(runDir, "report.html"), renderHtml(report));
}

export function writeScenarioTranscript(
  artifactDir: string,
  result: ScenarioResult,
): void {
  writeFileSync(
    path.join(artifactDir, "transcript.json"),
    `${JSON.stringify(result.transcript, null, 2)}\n`,
  );
  if (result.verdict) {
    writeFileSync(
      path.join(artifactDir, "verdict.json"),
      `${JSON.stringify(result.verdict, null, 2)}\n`,
    );
  }
}

function renderHtml(report: RunReport): string {
  const rows = report.results
    .map((r) => {
      const statusClass =
        r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "error";
      const checkpoints =
        r.verdict?.checkpoints
          .map(
            (c) =>
              `<li class="${c.pass ? "pass" : "fail"}">${escapeHtml(c.assertion)}: ${escapeHtml(c.reason)}</li>`,
          )
          .join("") ?? "";
      const bash = r.transcript.bash
        .slice(-10)
        .map(
          (b) =>
            `<pre><code>$ ${escapeHtml(b.command)}\nexit ${b.exitCode}\n${escapeHtml(b.stdout.slice(0, 500))}</code></pre>`,
        )
        .join("");
      return `<section class="scenario ${statusClass}">
        <h2>${escapeHtml(r.scenario)} <span class="badge">${r.status}</span></h2>
        <p>${(r.durationMs / 1000).toFixed(1)}s</p>
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
  <title>SAQ Report ${escapeHtml(report.runId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    .pass { color: #059669; }
    .fail, .error { color: #dc2626; }
    .badge { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; background: #e5e7eb; }
    pre { background: #f3f4f6; padding: 0.75rem; overflow-x: auto; font-size: 0.85rem; }
    summary { margin: 2rem 0 1rem; }
  </style>
</head>
<body>
  <h1>SAQ Run Report</h1>
  <p>Run ID: ${escapeHtml(report.runId)}</p>
  <p>Base URL: ${escapeHtml(report.baseUrl)}</p>
  <p>${report.summary.passed}/${report.summary.total} passed</p>
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
  baseUrl: string,
  startedAt: Date,
  results: ScenarioResult[],
): RunReport {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl,
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      errors,
    },
  };
}

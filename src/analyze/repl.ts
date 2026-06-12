import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { AnalyzeFinding, AnalyzeReport } from "./index.js";
import type { FlakyAnalyzeReport } from "./compare-runs.js";
import {
  canSplitHunk,
  computeDiffHunks,
  formatHunkBody,
  formatHunkHeader,
  splitHunk,
  type DiffHunk,
} from "./diff-hunks.js";
import {
  applyHunkList,
  editHunkInEditor,
  hunkMatchesAt,
} from "./hunk-editor.js";
import type { ScenarioFixProposal } from "./parse-proposal.js";
import {
  normalizeScenarioMarkdown,
  validateScenarioMarkdown,
} from "./validate-markdown.js";

export interface LlmReplEntry {
  finding: AnalyzeFinding;
  proposal: ScenarioFixProposal | null;
  parseError?: string;
}

export interface AnalyzeReplOptions {
  heuristicReport: AnalyzeReport;
  flakyReport?: FlakyAnalyzeReport;
  llmEntries: LlmReplEntry[];
  cwd: string;
  ask?: (prompt: string) => Promise<string>;
  waitForKey?: (message: string) => Promise<void>;
  editHunk?: (hunk: DiffHunk, filePath: string) => DiffHunk | null;
}

export interface AnalyzeReplResult {
  appliedFiles: string[];
  quit: boolean;
}

const PATCH_HELP = `y — apply this hunk
n — skip this hunk
e — edit this hunk in $EDITOR (save & close to apply if valid)
s — split this hunk into smaller hunks (when possible)
q — quit; unreviewed hunks are not applied
? — show this help`;

export async function waitForAnyKey(
  message: string,
  waitForKey?: (message: string) => Promise<void>,
): Promise<void> {
  if (waitForKey) {
    await waitForKey(message);
    return;
  }

  process.stdout.write(message);
  if (!process.stdin.isTTY) {
    await new Promise<void>((resolve) => {
      process.stdin.once("end", resolve);
      process.stdin.once("data", resolve);
    });
    process.stdout.write("\n");
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\n");
}

export function formatHunkDisplay(
  hunk: DiffHunk,
  index: number,
  total: number,
  filePath: string,
): string {
  const header = formatHunkHeader(hunk, index, total, filePath);
  const body = formatHunkBody(hunk)
    .split("\n")
    .map((line) => {
      if (line.startsWith("+")) return chalk.green(line);
      if (line.startsWith("-")) return chalk.red(line);
      return chalk.dim(line);
    })
    .join("\n");
  return `${chalk.bold(header)}\n${body}`;
}

interface ReviewFileResult {
  accepted: DiffHunk[];
  quit: boolean;
}

async function reviewFileHunks(options: {
  before: string;
  hunks: DiffHunk[];
  relPath: string;
  ask: (prompt: string) => Promise<string>;
  waitForKey?: (message: string) => Promise<void>;
  editHunk: (hunk: DiffHunk, filePath: string) => DiffHunk | null;
}): Promise<ReviewFileResult> {
  const pending = [...options.hunks];
  const accepted: DiffHunk[] = [];
  const fileLines = options.before.split("\n");
  let offset = 0;

  const recomputeOffset = (): void => {
    offset = 0;
    for (const hunk of accepted) {
      offset += hunk.added.length - hunk.removed.length;
    }
  };

  while (pending.length > 0) {
    const hunk = pending.shift()!;
    const total = pending.length + accepted.length + 1;
    const index = accepted.length;

    console.log("");
    console.log(formatHunkDisplay(hunk, index, total, options.relPath));

    while (true) {
      const answer = (
        await options.ask(chalk.bold("Stage this hunk [y/n/e/s/q/?]? "))
      ).toLowerCase();

      if (answer === "?" || answer === "h") {
        console.log(PATCH_HELP);
        await waitForAnyKey(
          chalk.dim("\nPress any key to continue… "),
          options.waitForKey,
        );
        continue;
      }

      if (answer === "q" || answer === "quit") {
        return { accepted, quit: true };
      }

      if (answer === "s" || answer === "split") {
        if (!canSplitHunk(hunk)) {
          console.log(chalk.yellow("Hunk cannot be split further."));
          continue;
        }
        const parts = splitHunk(hunk);
        if (!parts) {
          console.log(chalk.yellow("Hunk cannot be split further."));
          continue;
        }
        pending.unshift(parts[1]!);
        pending.unshift(parts[0]!);
        break;
      }

      if (answer === "e" || answer === "edit") {
        const edited = options.editHunk(hunk, options.relPath);
        if (!edited) {
          console.log(chalk.dim("Edit cancelled or editor failed."));
          continue;
        }
        recomputeOffset();
        if (!hunkMatchesAt(fileLines, edited, offset)) {
          console.log(
            chalk.red(
              "Edited hunk does not apply cleanly to the file — try again.",
            ),
          );
          continue;
        }
        accepted.push(edited);
        break;
      }

      if (answer === "y" || answer === "yes") {
        recomputeOffset();
        if (!hunkMatchesAt(fileLines, hunk, offset)) {
          console.log(
            chalk.red("Hunk no longer applies cleanly to the file."),
          );
          break;
        }
        accepted.push(hunk);
        break;
      }

      if (answer === "n" || answer === "no" || answer === "") {
        break;
      }

      console.log(chalk.dim("Unknown option. Type ? for help."));
    }
  }

  return { accepted, quit: false };
}

export async function runAnalyzeRepl(
  options: AnalyzeReplOptions,
): Promise<AnalyzeReplResult> {
  const appliedFiles: string[] = [];
  let quit = false;
  const editHunk = options.editHunk ?? editHunkInEditor;

  console.log("");
  console.log(chalk.bold("Heuristic analysis"));
  if (options.flakyReport) {
    console.log(formatFlakySummary(options.flakyReport));
  } else {
    console.log(formatHeuristicSummary(options.heuristicReport));
  }
  await waitForAnyKey(
    chalk.dim("\nPress any key to continue to LLM proposals… "),
    options.waitForKey,
  );

  if (options.llmEntries.length === 0) {
    console.log(chalk.green("\nNo failed scenarios — nothing to review."));
    return { appliedFiles, quit: false };
  }

  const rl = options.ask ? undefined : createInterface({ input, output });
  const ask =
    options.ask ?? ((prompt: string) => rl!.question(prompt).then((a) => a.trim()));

  try {
    for (const entry of options.llmEntries) {
      if (quit) break;

      console.log("");
      console.log(chalk.bold.cyan(`Scenario: ${entry.finding.scenario}`));
      console.log(chalk.dim(entry.finding.filePath));

      if (!entry.proposal) {
        console.log(
          chalk.red(
            `LLM analysis failed: ${entry.parseError ?? "unknown error"}`,
          ),
        );
        await waitForAnyKey(
          chalk.dim("Press any key to continue… "),
          options.waitForKey,
        );
        continue;
      }

      console.log("");
      if (entry.proposal.flakeDiagnosis) {
        const d = entry.proposal.flakeDiagnosis;
        console.log(
          chalk.magenta(
            `Flake diagnosis: ${d.type} [${d.confidence}] — ${d.explanation}`,
          ),
        );
        console.log("");
      }

      console.log(entry.proposal.rationale);

      if (
        !entry.proposal.shouldEditScenario ||
        !entry.proposal.revisedMarkdown
      ) {
        console.log(chalk.yellow("\nNo scenario edit proposed."));
        await waitForAnyKey(
          chalk.dim("Press any key to continue… "),
          options.waitForKey,
        );
        continue;
      }

      const resolved = path.isAbsolute(entry.finding.filePath)
        ? entry.finding.filePath
        : path.resolve(options.cwd, entry.finding.filePath);

      const before = readFileSync(resolved, "utf-8");
      const after = normalizeScenarioMarkdown(entry.proposal.revisedMarkdown);
      const hunks = computeDiffHunks(before, after);
      const relPath = path.relative(options.cwd, resolved);

      if (hunks.length === 0) {
        console.log(chalk.dim("\nNo diff hunks — skipping file."));
        await waitForAnyKey(
          chalk.dim("Press any key to continue… "),
          options.waitForKey,
        );
        continue;
      }

      const review = await reviewFileHunks({
        before,
        hunks,
        relPath,
        ask,
        waitForKey: options.waitForKey,
        editHunk,
      });

      if (review.quit) {
        quit = true;
      }

      if (review.accepted.length > 0) {
        try {
          const merged = applyHunkList(before, review.accepted);
          const normalized = normalizeScenarioMarkdown(merged);
          const err = writeScenarioFile(resolved, normalized);
          if (err) {
            console.error(chalk.red(`Failed to write ${relPath}: ${err}`));
          } else {
            console.log(
              chalk.green(
                `Updated ${relPath} (${review.accepted.length} hunk(s) applied)`,
              ),
            );
            appliedFiles.push(resolved);
          }
        } catch (err) {
          console.error(chalk.red(String(err)));
        }
      }

      if (quit) break;
    }
  } finally {
    rl?.close();
  }

  return { appliedFiles, quit };
}

export function formatHeuristicSummary(report: AnalyzeReport): string {
  if (report.findings.length === 0) {
    return chalk.green(`Run ${report.runId}: all scenarios passed.`);
  }

  const lines: string[] = [
    chalk.dim(`Run ${report.runId}`),
    chalk.bold(`${report.findings.length} failed scenario(s):`),
    "",
  ];

  for (const f of report.findings) {
    const kindColor =
      f.failureKind === "scenario_issue"
        ? chalk.yellow
        : f.failureKind === "product"
          ? chalk.red
          : f.failureKind === "infrastructure"
            ? chalk.magenta
            : f.failureKind === "transient"
              ? chalk.cyan
              : chalk.gray;

    lines.push(
      `• ${chalk.bold(f.scenario)} — ${kindColor(f.failureKind)} [${f.confidence}]`,
    );
    if (f.signals.length > 0) {
      lines.push(chalk.dim(`  signals: ${f.signals.join(", ")}`));
    }
    for (const s of f.suggestions.slice(0, 3)) {
      lines.push(chalk.dim(`  - ${s}`));
    }
  }

  return lines.join("\n");
}

export function formatFlakySummary(report: FlakyAnalyzeReport): string {
  if (report.findings.length === 0) {
    return chalk.green(
      `No flaky scenarios across ${report.runIds.length} run(s).`,
    );
  }

  const lines: string[] = [
    chalk.bold(
      `Flaky scenarios across ${report.runIds.length} run(s):`,
    ),
    chalk.dim(`Runs: ${report.runIds.join(", ")}`),
    "",
  ];

  for (const f of report.findings) {
    lines.push(
      `  ${chalk.bold(f.scenario)}  ${f.passCount} pass / ${f.failCount} fail / ${f.errorCount} error`,
    );
    for (const cp of f.inconsistentCheckpoints.slice(0, 3)) {
      lines.push(
        chalk.dim(
          `    checkpoint flip: "${cp.assertion}" (pass: ${cp.passedIn.length}, fail: ${cp.failedIn.length})`,
        ),
      );
    }
    const assessment = f.heuristicAssessment;
    const hints: string[] = [];
    if (assessment.likelyFalseNegative) hints.push("likely false negative");
    if (assessment.likelyFalsePositive) hints.push("likely false positive");
    if (hints.length > 0) {
      lines.push(
        chalk.dim(
          `    diagnosis hint: ${hints.join(", ")} [${assessment.dominantKind}]`,
        ),
      );
    }
    for (const w of f.filePathWarnings) {
      lines.push(chalk.yellow(`    warning: ${w}`));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function writeScenarioFile(filePath: string, markdown: string): string | undefined {
  try {
    validateScenarioMarkdown(markdown, path.basename(filePath));
    writeFileSync(filePath, markdown, "utf-8");
    return undefined;
  } catch (err) {
    return String(err);
  }
}

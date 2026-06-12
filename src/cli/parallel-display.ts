import chalk from "chalk";
import type { ScenarioResult } from "../types/verdict.js";

export type ScenarioFailureLogger = (result: ScenarioResult) => void;

export type EntryStatus = "running" | ScenarioResult["status"];

export interface StatusEntry {
  name: string;
  status: EntryStatus;
}

export function plainParallelStatusLine(entry: StatusEntry): string {
  if (entry.status === "running") {
    return `- [${entry.name}] running...`;
  }
  if (entry.status === "pass") {
    return `✔ [${entry.name}] passed`;
  }
  return `✖ [${entry.name}] ${entry.status}`;
}

export function formatParallelStatusLine(entry: StatusEntry): string {
  const plain = plainParallelStatusLine(entry);
  if (entry.status === "pass") {
    return chalk.green(plain);
  }
  if (entry.status !== "running") {
    return chalk.red(plain);
  }
  return plain;
}

/** Rewrite a contiguous status block in the terminal. */
export function buildParallelStatusBlock(
  entries: StatusEntry[],
  previousLineCount: number,
): { output: string; lineCount: number } {
  const lines = entries.map((entry) => formatParallelStatusLine(entry));
  const chunks: string[] = [];

  if (previousLineCount > 0) {
    chunks.push(`\x1b[${previousLineCount}A`);
  }

  for (const line of lines) {
    chunks.push(`\x1b[2K${line}\n`);
  }

  return { output: chunks.join(""), lineCount: lines.length };
}

/** In-place status lines for parallel scenario workers. */
export class ParallelScenarioDisplay {
  private readonly isTTY = Boolean(process.stdout.isTTY);
  private readonly entries: StatusEntry[] = [];
  private renderedLineCount = 0;
  private redrawChain: Promise<void> = Promise.resolve();

  start(name: string): void {
    if (!this.isTTY) return;
    this.entries.push({ name, status: "running" });
    this.enqueueRedraw();
  }

  finish(
    name: string,
    result: ScenarioResult,
    bufferedLines: string[],
    logFailureReason: ScenarioFailureLogger,
  ): void {
    const entry = this.entries.find((item) => item.name === name);
    if (entry) {
      entry.status = result.status;
    }

    if (this.isTTY) {
      this.enqueueRedraw();
      for (const line of bufferedLines) {
        process.stdout.write(`${line}\n`);
      }
    } else {
      for (const line of bufferedLines) {
        process.stdout.write(`${line}\n`);
      }
      console.log(plainParallelStatusLine({ name, status: result.status }));
    }

    if (result.status !== "pass") {
      logFailureReason(result);
    }
  }

  private enqueueRedraw(): void {
    this.redrawChain = this.redrawChain.then(() => {
      const block = buildParallelStatusBlock(
        this.entries,
        this.renderedLineCount,
      );
      process.stdout.write(block.output);
      this.renderedLineCount = block.lineCount;
    });
  }
}

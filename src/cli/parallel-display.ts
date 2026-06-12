import chalk from "chalk";
import ora, { type Ora } from "ora";
import type { ScenarioResult } from "../types/verdict.js";

export type ScenarioFailureLogger = (result: ScenarioResult) => void;

/** In-place status lines for parallel scenario workers. */
export class ParallelScenarioDisplay {
  private readonly spinners = new Map<string, Ora>();
  private readonly isTTY = Boolean(process.stdout.isTTY);

  start(name: string): void {
    if (!this.isTTY) return;
    const spinner = ora({ text: `[${name}] running...` }).start();
    this.spinners.set(name, spinner);
  }

  finish(
    name: string,
    result: ScenarioResult,
    bufferedLines: string[],
    logFailureReason: ScenarioFailureLogger,
  ): void {
    for (const line of bufferedLines) {
      process.stdout.write(`${line}\n`);
    }

    if (result.status === "pass") {
      const plain = `[${name}] passed`;
      const message = this.isTTY ? chalk.green(plain) : plain;
      const spinner = this.spinners.get(name);
      if (spinner) {
        spinner.succeed(message);
        this.spinners.delete(name);
      } else {
        console.log(message);
      }
      return;
    }

    const plain = `[${name}] ${result.status}`;
    const message = this.isTTY ? chalk.red(plain) : plain;
    const spinner = this.spinners.get(name);
    if (spinner) {
      spinner.fail(message);
      this.spinners.delete(name);
    } else {
      console.log(message);
    }
    logFailureReason(result);
  }
}

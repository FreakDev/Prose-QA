import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { ScenarioResult } from "../types/verdict.js";
import { emptyTranscript } from "./concurrency.js";
import {
  buildParallelStatusBlock,
  ParallelScenarioDisplay,
} from "./parallel-display.js";

function stubResult(
  overrides: Partial<ScenarioResult> & Pick<ScenarioResult, "scenario" | "status">,
): ScenarioResult {
  return {
    filePath: "scenarios/example.md",
    durationMs: 1000,
    verdict: null,
    transcript: emptyTranscript(),
    ...overrides,
  };
}

describe("ParallelScenarioDisplay", () => {
  let stdoutLines: string[];
  let originalIsTTY: boolean | undefined;
  let originalWrite: typeof process.stdout.write;
  let originalLog: typeof console.log;

  beforeEach(() => {
    stdoutLines = [];
    originalIsTTY = process.stdout.isTTY;
    originalWrite = process.stdout.write.bind(process.stdout);
    originalLog = console.log.bind(console);
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutLines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.log = ((...args: unknown[]) => {
      stdoutLines.push(`${args.join(" ")}\n`);
    }) as typeof console.log;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
    process.stdout.write = originalWrite;
    console.log = originalLog;
  });

  it("prints only the final status line when stdout is not a TTY", () => {
    const display = new ParallelScenarioDisplay();
    const result = stubResult({ scenario: "login-admin", status: "pass" });

    display.start("login-admin");
    display.finish("login-admin", result, ["[login-admin] hook log"], () => {});

    assert.equal(
      stdoutLines.join(""),
      "[login-admin] hook log\n✔ [login-admin] passed\n",
    );
  });

  it("prints failure reason via callback after the final status line", () => {
    const display = new ParallelScenarioDisplay();
    const result = stubResult({
      scenario: "checkout",
      status: "fail",
      verdict: {
        status: "fail",
        summary: "Cart empty",
        checkpoints: [],
      },
    });
    const failureLines: string[] = [];

    display.finish("checkout", result, [], (r) => {
      failureLines.push(r.verdict?.summary ?? "");
    });

    assert.match(stdoutLines.at(-1) ?? "", /checkout.*fail/);
    assert.deepEqual(failureLines, ["Cart empty"]);
  });

  it("rewrites the same scenario slot when status changes", () => {
    const running = buildParallelStatusBlock(
      [
        { name: "foo", status: "running" },
        { name: "bar", status: "running" },
      ],
      0,
    );
    const finished = buildParallelStatusBlock(
      [
        { name: "foo", status: "pass" },
        { name: "bar", status: "running" },
      ],
      running.lineCount,
    );

    const cleaned = finished.output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    const visibleLines = cleaned.split("\n").filter(Boolean);

    assert.equal(visibleLines.length, 2);
    assert.equal((cleaned.match(/\[foo\]/g) ?? []).length, 1);
    assert.match(cleaned, /✔ \[foo\] passed/);
    assert.match(cleaned, /- \[bar\] running\.\.\./);
  });
});

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, it } from "node:test";
import {
  killAllScenarioWorkers,
  resolveCliInvocation,
  trackScenarioWorker,
} from "./subprocess.js";

describe("killAllScenarioWorkers", () => {
  it("sends the signal to tracked workers", () => {
    const signals: NodeJS.Signals[] = [];
    let killed = false;
    const child = {
      get killed() {
        return killed;
      },
      exitCode: null,
      once() {
        return child;
      },
      kill(signal: NodeJS.Signals) {
        signals.push(signal);
        killed = true;
      },
    } as unknown as ChildProcess;

    trackScenarioWorker(child);
    killAllScenarioWorkers("SIGINT");
    assert.deepEqual(signals, ["SIGINT"]);
  });

  it("terminates a real child process", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1_000_000)",
    ]);
    trackScenarioWorker(child);
    killAllScenarioWorkers("SIGTERM");

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child did not exit")), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});

describe("resolveCliInvocation", () => {
  it("returns node + script path for compiled CLI", () => {
    const original = process.argv[1];
    process.argv[1] = "/project/dist/cli/index.js";
    try {
      const inv = resolveCliInvocation();
      assert.equal(inv.command, process.execPath);
      assert.deepEqual(inv.baseArgs, ["/project/dist/cli/index.js"]);
    } finally {
      if (original !== undefined) {
        process.argv[1] = original;
      }
    }
  });

  it("uses tsx loader for TypeScript CLI entry", () => {
    const original = process.argv[1];
    process.argv[1] = "/project/src/cli/index.ts";
    try {
      const inv = resolveCliInvocation();
      assert.equal(inv.command, process.execPath);
      assert.deepEqual(inv.baseArgs, [
        "--import",
        "tsx",
        "/project/src/cli/index.ts",
      ]);
    } finally {
      if (original !== undefined) {
        process.argv[1] = original;
      }
    }
  });
});

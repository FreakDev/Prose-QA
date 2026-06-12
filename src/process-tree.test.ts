import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { killProcessTree } from "./process-tree.js";

describe("killProcessTree", () => {
  it("terminates a detached process group including grandchildren", async () => {
    if (process.platform === "win32") return;

    const child = spawn(
      process.execPath,
      [
        "-e",
        `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000_000)"], {
  detached: process.platform !== "win32",
  stdio: "ignore",
});
grandchild.unref();
setInterval(() => {}, 1_000_000);
        `.trim(),
      ],
      { detached: true, stdio: "ignore" },
    );

    await new Promise<void>((resolve) => {
      child.once("spawn", () => resolve());
    });

    killProcessTree(child.pid, "SIGKILL");

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("process group did not exit")),
        5000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});

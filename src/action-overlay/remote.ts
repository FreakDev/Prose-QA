import { runBash as defaultRunBash } from "../agent/bash.js";

type RunBashFn = typeof defaultRunBash;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runOverlayEval(
  js: string,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
  execBash: RunBashFn = defaultRunBash,
): Promise<boolean> {
  const encoded = Buffer.from(js, "utf-8").toString("base64");
  const entry = await execBash(`agent-browser eval -b ${shellQuote(encoded)}`, {
    ...options,
    timeoutMs: Math.min(options.timeoutMs, 15_000),
  });
  return entry.exitCode === 0;
}

export type OverlayHudOutcome = "passed" | "failed" | "stopped";

export async function setOverlayScenario(
  name: string,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
  execBash: RunBashFn = defaultRunBash,
): Promise<void> {
  await runOverlayEval(
    `window.__pqaOverlay.setScenario(${JSON.stringify(name)})`,
    options,
    execBash,
  );
}

export async function setOverlayOutcome(
  outcome: OverlayHudOutcome,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
  execBash: RunBashFn = defaultRunBash,
): Promise<void> {
  await runOverlayEval(
    `window.__pqaOverlay.setOutcome(${JSON.stringify(outcome)})`,
    options,
    execBash,
  );
}

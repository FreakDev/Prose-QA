import { runBash as defaultRunBash } from "../agent/bash.js";
import {
  parseAgentBrowserAction,
  type ParsedAgentBrowserAction,
} from "./parse-command.js";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type RunBashFn = typeof defaultRunBash;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBoxJson(stdout: string): ElementBox | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const jsonStart = trimmed.indexOf("{");
  const slice = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

  try {
    const payload = JSON.parse(slice) as {
      success?: boolean;
      data?: { x?: number; y?: number; width?: number; height?: number };
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    const box = payload.data ?? payload;
    if (
      typeof box.x === "number" &&
      typeof box.y === "number" &&
      typeof box.width === "number" &&
      typeof box.height === "number"
    ) {
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEvalPayload(
  action: ParsedAgentBrowserAction,
  box: ElementBox | null,
  intent?: string,
): string {
  const hud = {
    intent: intent?.trim() ?? "",
    detail: action.label,
  };
  if (action.category === "mutation" && box) {
    return `window.__pqaOverlay.showMutation(${JSON.stringify({
      ...hud,
      box,
    })})`;
  }
  return `window.__pqaOverlay.showHud(${JSON.stringify(hud)})`;
}

async function fetchElementBox(
  target: string,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
  execBash: RunBashFn,
): Promise<ElementBox | null> {
  const entry = await execBash(
    `agent-browser get box ${shellQuote(target)} --json`,
    options,
  );
  if (entry.exitCode !== 0) return null;
  return parseBoxJson(entry.stdout);
}

async function runOverlayEval(
  js: string,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
  execBash: RunBashFn,
): Promise<boolean> {
  const encoded = Buffer.from(js, "utf-8").toString("base64");
  const entry = await execBash(`agent-browser eval -b ${shellQuote(encoded)}`, {
    ...options,
    timeoutMs: Math.min(options.timeoutMs, 15_000),
  });
  return entry.exitCode === 0;
}

export async function previewAction(
  options: {
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    previewMs: number;
    intent?: string;
    verbose?: boolean;
  },
  execBash: RunBashFn = defaultRunBash,
): Promise<void> {
  const action = parseAgentBrowserAction(options.command);
  if (!action) return;

  const bashOpts = {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs,
  };

  let box: ElementBox | null = null;
  if (action.category === "mutation" && action.target) {
    box = await fetchElementBox(action.target, bashOpts, execBash);
  }

  const evalJs = buildEvalPayload(action, box, options.intent);
  const ok = await runOverlayEval(evalJs, bashOpts, execBash);
  if (!ok && options.verbose) {
    console.warn(`[action-overlay] eval failed for: ${action.label}`);
  }

  await sleep(options.previewMs);
}

export async function maybePreviewAction(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  previewMs: number;
  intent?: string;
  verbose?: boolean;
}): Promise<void> {
  return previewAction(options);
}

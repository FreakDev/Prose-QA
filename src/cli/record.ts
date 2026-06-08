import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  loadConfig,
  missingLlmApiKey,
  resolveSensitiveEnvVars,
} from "../config/load.js";
import { buildBrowserEnv, runBash, closeBrowserSession } from "../agent/bash.js";
import {
  appendEvent,
  ensureRecordingDir,
  newRecordingId,
  readMeta,
  recordingDir,
  writeMeta,
} from "../recorder/events.js";
import {
  spawnRecordingBridgeWorker,
  stopRecordingBridgeWorker,
} from "../recorder/bridge-process.js";
import { writePageRecorderScript } from "../recorder/page-script.js";
import {
  clearActiveRecording,
  readActiveRecording,
  resolveRecorderConfig,
  writeActiveRecording,
} from "../recorder/session.js";
import {
  defaultOutputPath,
  generateScenarioFromRecording,
} from "../recorder/generate-scenario.js";
export interface RecordStartOptions {
  configPath?: string;
  url?: string;
  headed?: boolean;
  session?: string;
  connect?: number;
  verbose?: boolean;
}

export interface RecordStopOptions {
  configPath?: string;
  name?: string;
  out?: string;
  skipGenerate?: boolean;
  verbose?: boolean;
}

export interface RecordGenerateOptions {
  configPath?: string;
  name?: string;
  out?: string;
  verbose?: boolean;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function executeRecordStart(
  options: RecordStartOptions,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);
  const recorder = resolveRecorderConfig(config.recorder);
  const existing = readActiveRecording(cwd, recorder.outputDir);
  if (existing) {
    console.error(
      chalk.red(
        `Recording already active (${existing.id}). Run \`pqa record stop\` first.`,
      ),
    );
    return 2;
  }

  const id = newRecordingId();
  const dir = recordingDir(cwd, recorder.outputDir, id);
  ensureRecordingDir(dir);

  const sessionName = options.session ?? `${config.browser.sessionName}-record`;
  let bridge: { url: string; pid: number };
  try {
    bridge = await spawnRecordingBridgeWorker({
      projectRoot: cwd,
      recordingDir: dir,
      port: recorder.bridgePort,
      configPath: options.configPath,
    });
  } catch (err) {
    console.error(chalk.red(`Failed to start recording bridge: ${err}`));
    return 2;
  }

  const scriptPath = path.join(os.tmpdir(), `pqa-recorder-${id}.js`);
  writePageRecorderScript(bridge.url, scriptPath);

  const headed = options.headed !== false;
  const bashEnv = buildBrowserEnv({
    headed,
    sessionName,
    artifactDir: dir,
  });

  const timeoutMs = config.agent.bashTimeoutMs;

  await runBash("agent-browser close 2>/dev/null || true", {
    cwd,
    timeoutMs,
    env: bashEnv,
  });

  let openCmd: string;
  if (options.connect) {
    openCmd = `agent-browser connect ${options.connect}`;
    const connectEntry = await runBash(openCmd, { cwd, timeoutMs, env: bashEnv });
    if (connectEntry.exitCode !== 0) {
      console.error(chalk.red(connectEntry.stderr || connectEntry.stdout));
      stopRecordingBridgeWorker(bridge.pid);
      return 2;
    }
    await runBash(`agent-browser addinitscript "${scriptPath}"`, {
      cwd,
      timeoutMs,
      env: bashEnv,
    });
    if (options.url) {
      await runBash(`agent-browser open "${options.url}"`, {
        cwd,
        timeoutMs,
        env: bashEnv,
      });
    }
  } else {
    const url = options.url ?? "about:blank";
    openCmd = `agent-browser --headed open --init-script "${scriptPath}" "${url}"`;
    const openEntry = await runBash(openCmd, { cwd, timeoutMs, env: bashEnv });
    if (openEntry.exitCode !== 0) {
      console.error(chalk.red(openEntry.stderr || openEntry.stdout));
      stopRecordingBridgeWorker(bridge.pid);
      return 2;
    }
  }

  writeMeta(dir, {
    id,
    startedAt: new Date().toISOString(),
    startUrl: options.url,
    sessionName,
    bridgePort: recorder.bridgePort,
    connectPort: options.connect,
  });

  writeActiveRecording(cwd, recorder.outputDir, {
    id,
    dir,
    bridgePort: recorder.bridgePort,
    sessionName,
    bridgeUrl: bridge.url,
    bridgePid: bridge.pid,
  });

  console.log(chalk.green(`Recording started: ${id}`));
  console.log(chalk.dim(`  Directory: ${dir}`));
  console.log(chalk.dim(`  Bridge: ${bridge.url}`));
  console.log(
    chalk.dim(
      "  Add notes: pqa record note \"...\"  |  Checkpoints: pqa record checkpoint \"...\"",
    ),
  );
  console.log(chalk.dim("  Stop: pqa record stop [--name my-scenario]"));

  return 0;
}

function requireActiveRecording(cwd: string, outputDir: string) {
  const active = readActiveRecording(cwd, outputDir);
  if (!active) {
    throw new Error(
      "No active recording. Start one with `pqa record start --url <url>`.",
    );
  }
  return active;
}

export async function executeRecordNoteAsync(
  text: string,
  configPath?: string,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(configPath, cwd);
  const recorder = resolveRecorderConfig(config.recorder);
  try {
    const active = requireActiveRecording(cwd, recorder.outputDir);
    appendEvent(
      active.dir,
      { type: "comment", text, ts: Date.now() },
      resolveSensitiveEnvVars(config),
    );
    console.log(chalk.green("Note recorded."));
    return 0;
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }
}

export async function executeRecordCheckpointAsync(
  text: string,
  configPath?: string,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(configPath, cwd);
  const recorder = resolveRecorderConfig(config.recorder);
  try {
    const active = requireActiveRecording(cwd, recorder.outputDir);
    appendEvent(
      active.dir,
      { type: "checkpoint_hint", text, ts: Date.now() },
      resolveSensitiveEnvVars(config),
    );
    console.log(chalk.green("Checkpoint hint recorded."));
    return 0;
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }
}

export async function executeRecordStop(
  options: RecordStopOptions,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);
  const recorder = resolveRecorderConfig(config.recorder);

  let active: ReturnType<typeof readActiveRecording>;
  try {
    active = requireActiveRecording(cwd, recorder.outputDir);
  } catch (err) {
    console.error(chalk.red(String(err)));
    return 2;
  }

  stopRecordingBridgeWorker(active.bridgePid);

  const meta = readMeta(active.dir);
  meta.endedAt = new Date().toISOString();
  writeMeta(active.dir, meta);

  const sessionName = active.sessionName;
  const headed = true;
  await closeBrowserSession({
    cwd,
    timeoutMs: config.agent.bashTimeoutMs,
    sessionName,
    headed,
    verbose: options.verbose,
  });

  clearActiveRecording(cwd, recorder.outputDir);

  console.log(chalk.green(`Recording stopped: ${active.id}`));

  if (options.skipGenerate) {
    console.log(chalk.dim(`Events saved in ${active.dir}`));
    return 0;
  }

  const missingKey = missingLlmApiKey(config);
  if (missingKey) {
    console.error(chalk.red(`${missingKey} — cannot generate scenario.`));
    console.log(
      chalk.dim(
        `Run later: pqa record generate ${active.dir}`,
      ),
    );
    return 2;
  }

  const scenarioName =
    options.name ?? (slugify(meta.startUrl ?? active.id) || "recorded-scenario");
  const outputPath =
    options.out ?? defaultOutputPath(cwd, scenarioName);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const spinner = ora("Generating scenario with LLM…").start();
  try {
    const result = await generateScenarioFromRecording({
      config,
      recordingDir: active.dir,
      cwd,
      scenarioName,
      outputPath,
    });
    spinner.succeed(`Wrote ${result.outputPath}`);
    console.log(
      chalk.dim(
        `Validate: pqa debug ${path.relative(cwd, result.outputPath)} --verbose --headed`,
      ),
    );
    return 0;
  } catch (err) {
    spinner.fail(String(err));
    return 2;
  }
}

export async function executeRecordGenerate(
  recordingPath: string,
  options: RecordGenerateOptions,
): Promise<number> {
  const cwd = process.cwd();
  const config = await loadConfig(options.configPath, cwd);
  const missingKey = missingLlmApiKey(config);
  if (missingKey) {
    console.error(chalk.red(missingKey));
    return 2;
  }

  const dir = path.resolve(cwd, recordingPath);
  const meta = readMeta(dir);
  const scenarioName =
    options.name ?? (slugify(meta.startUrl ?? meta.id) || "recorded-scenario");
  const outputPath =
    options.out ?? defaultOutputPath(cwd, scenarioName);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const spinner = ora("Generating scenario with LLM…").start();
  try {
    const result = await generateScenarioFromRecording({
      config,
      recordingDir: dir,
      cwd,
      scenarioName,
      outputPath,
    });
    spinner.succeed(`Wrote ${result.outputPath}`);
    return 0;
  } catch (err) {
    spinner.fail(String(err));
    return 2;
  }
}

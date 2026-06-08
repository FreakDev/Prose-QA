/**
 * Detached bridge process: stays alive after `pqa record start` exits so the
 * browser can POST events until `pqa record stop`.
 *
 * Usage: tsx bridge-worker.ts --dir <recordingDir> --port <port> --cwd <projectRoot> [--config <path>]
 */
import { loadConfig, resolveSensitiveEnvVars } from "../config/load.js";
import { enqueueEnrichedAppend } from "./enrich-event.js";
import { startRecordingBridge } from "./bridge.js";

function parseArgs(argv: string[]): {
  dir: string;
  port: number;
  cwd: string;
  configPath?: string;
} {
  let dir = "";
  let port = 17_321;
  let cwd = process.cwd();
  let configPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dir" && next) {
      dir = next;
      i++;
      continue;
    }
    if (arg === "--port" && next) {
      port = Number(next);
      i++;
      continue;
    }
    if (arg === "--cwd" && next) {
      cwd = next;
      i++;
      continue;
    }
    if ((arg === "--config" || arg === "--config-path") && next) {
      configPath = next;
      i++;
    }
  }

  if (!dir) {
    console.error("bridge-worker: missing --dir");
    process.exit(2);
  }
  return { dir, port, cwd, configPath };
}

async function main(): Promise<void> {
  const { dir, port, cwd, configPath } = parseArgs(process.argv);
  const config = await loadConfig(configPath, cwd);
  const sensitive = resolveSensitiveEnvVars(config);

  const bridge = await startRecordingBridge({
    port,
    onEvent: (event) => {
      enqueueEnrichedAppend({
        cwd,
        recordingDir: dir,
        config,
        event,
        sensitiveEnvVars: sensitive,
      });
    },
  });

  process.stdout.write(`${bridge.url}\n`);

  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

const isMain =
  process.argv[1]?.endsWith("bridge-worker.ts") ||
  process.argv[1]?.endsWith("bridge-worker.js");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

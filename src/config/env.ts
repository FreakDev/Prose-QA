import dotenvFlow from "dotenv-flow";

export function loadEnv(cwd = process.cwd()): void {
  dotenvFlow.config({
    path: cwd,
    default_node_env: "development",
    silent: true,
  });
}

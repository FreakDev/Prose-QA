import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package version from package.json (resolved at runtime from repo root). */
export const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8"),
).version as string;

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPackageRoot } from "./paths.js";

/** Package version from package.json (resolved at runtime from package root). */
export const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(join(getPackageRoot(), "package.json"), "utf8"),
).version as string;

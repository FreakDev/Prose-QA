import type { PqaConfig } from "../types/config.js";
import { resolveCacheConfig } from "../config/load.js";

export { resolveCacheConfig };

export function isCacheEnabled(
  config: PqaConfig,
  noCache?: boolean,
): boolean {
  if (noCache) return false;
  return resolveCacheConfig(config).enabled;
}

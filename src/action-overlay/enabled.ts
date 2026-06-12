import type { BrowserEngine, PqaConfig } from "../types/config.js";

export const DEFAULT_ACTION_OVERLAY_PREVIEW_MS = 800;

export function resolveActionOverlayPreviewMs(config: PqaConfig): number {
  const ms = config.extensions?.actionOverlay?.previewMs;
  if (ms === undefined || ms < 0) return DEFAULT_ACTION_OVERLAY_PREVIEW_MS;
  return ms;
}

export function isActionOverlayEnabled(options: {
  actionOverlay?: boolean;
  config: PqaConfig;
  headed: boolean;
  engine: BrowserEngine;
}): boolean {
  const flag =
    options.actionOverlay ??
    options.config.extensions?.actionOverlay?.enabled ??
    false;
  return flag && options.headed && options.engine === "chrome";
}

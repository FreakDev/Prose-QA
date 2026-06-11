import {
  BrowserHealthError,
  checkBashResult,
} from "../agent/browser-health.js";
import type { PostToolHook } from "../types/hooks.js";

export const browserHealthPostToolHook: PostToolHook = (entry) => {
  const issue = checkBashResult(entry);
  if (!issue || !issue.fatal) {
    return { action: "continue" };
  }
  return {
    action: "abort",
    error: new BrowserHealthError(issue).message,
  };
};

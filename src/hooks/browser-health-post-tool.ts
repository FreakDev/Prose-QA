import { runBash } from "../agent/bash.js";
import {
  BrowserHealthError,
  buildFailureFingerprint,
  checkUrlForBrowserError,
  evaluateBrowserHealthAfterBash,
  isOpenBrowserCommand,
  type BrowserHealthIssue,
} from "../agent/browser-health.js";
import { appendTranscriptBash } from "../agent/verdict.js";
import type { PostToolHook } from "../types/hooks.js";

function abortFromIssue(issue: BrowserHealthIssue) {
  return {
    action: "abort" as const,
    error: new BrowserHealthError(issue).message,
  };
}

export const browserHealthPostToolHook: PostToolHook = async (entry, ctx) => {
  const withinTurn =
    (ctx.metadata.browserFailureFingerprints as string[] | undefined) ?? [];

  if (entry.command.includes("agent-browser") && entry.exitCode !== 0) {
    ctx.metadata.browserFailureFingerprints = [
      ...withinTurn,
      buildFailureFingerprint(entry),
    ];
  }

  const updatedWithinTurn =
    (ctx.metadata.browserFailureFingerprints as string[] | undefined) ?? [];

  const issue = evaluateBrowserHealthAfterBash({
    entry,
    transcript: ctx.transcript,
    config: ctx.config,
    withinTurnFingerprints: updatedWithinTurn,
  });
  if (issue?.fatal) {
    return abortFromIssue(issue);
  }

  if (isOpenBrowserCommand(entry.command) && entry.exitCode === 0) {
    const bashEnv = ctx.metadata.bashEnv as Record<string, string> | undefined;
    const bashTimeoutMs = ctx.metadata.bashTimeoutMs as number | undefined;
    if (bashEnv && bashTimeoutMs) {
      const urlEntry = await runBash("agent-browser get url", {
        cwd: ctx.cwd,
        timeoutMs: bashTimeoutMs,
        env: bashEnv as NodeJS.ProcessEnv,
      });
      appendTranscriptBash(ctx.transcript, urlEntry);

      const preparedStartUrl = ctx.metadata.preparedStartUrl as
        | string
        | undefined;
      const urlIssue = checkUrlForBrowserError(
        urlEntry.stdout.trim(),
        preparedStartUrl,
      );
      if (urlIssue?.fatal) {
        return abortFromIssue(urlIssue);
      }
    }
  }

  return { action: "continue" };
};

import type { CheckpointResult } from "../types/verdict.js";

export function buildRecoveryPrompt(failed: CheckpointResult[]): string {
  const list = failed
    .map(
      (c, i) =>
        `${i + 1}. **${c.assertion}**\n   Previous reason: ${c.reason}`,
    )
    .join("\n");

  return `## Recovery mode

One or more Then checkpoints failed due to likely timing or stale UI state. Re-verify **only** the failed checkpoints below.

### Failed checkpoints
${list}

### Rules (strict)
- Do **not** change checkpoint wording or pass criteria.
- Do **not** declare pass without fresh CLI evidence for each failed checkpoint.
- Do **not** skip checkpoints or relax assertions.
- Allowed: \`agent-browser wait\`, \`agent-browser snapshot -i\`, re-run verification commands, re-click with **fresh** \`@eN\` refs from a new snapshot.
- If a checkpoint still fails after recovery, keep \`pass: false\` with updated evidence.
- On failure, save artifacts to \`$PQA_ARTIFACT_DIR\` (screenshot + snapshot).

Reply with an updated JSON verdict block covering **all** Then checkpoints (passed and failed).`;
}

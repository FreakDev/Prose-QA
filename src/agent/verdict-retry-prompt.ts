import type { Scenario } from "../types/scenario.js";

export function buildVerdictRetryPrompt(scenario: Scenario): string {
  const list = scenario.then
    .map((assertion, i) => `${i + 1}. **${assertion}**`)
    .join("\n");

  return `## Verdict required

All Steps are complete (or the harness is ending this run). Emit your **final JSON verdict** now.

### Then checkpoints (${scenario.then.length} total — include each exactly once)
${list}

### Rules (strict)
- Do **not** use bash or read tools unless you lack CLI evidence for a checkpoint you already verified in this run.
- Your reply must include a fenced \`\`\`json block with \`status\`, \`checkpoints\`, and \`summary\` per the system prompt schema.
- \`status\` is \`"pass"\` only if every checkpoint passes with concrete CLI evidence.
- Map every Then bullet above to one \`checkpoints[]\` entry using the same assertion text.`;
}

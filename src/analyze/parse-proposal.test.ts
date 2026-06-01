import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractScenarioFixProposal } from "./parse-proposal.js";

describe("extractScenarioFixProposal", () => {
  it("parses JSON from fenced block", () => {
    const text = `\`\`\`json
{
  "shouldEditScenario": true,
  "rationale": "Move checkpoint earlier.",
  "changes": ["Move Then item"],
  "revisedMarkdown": "---\\nname: x\\n---\\n"
}
\`\`\``;
    const proposal = extractScenarioFixProposal(text);
    assert.ok(proposal);
    assert.equal(proposal!.shouldEditScenario, true);
    assert.equal(proposal!.changes[0], "Move Then item");
  });

  it("returns null for invalid payload", () => {
    assert.equal(extractScenarioFixProposal("not json"), null);
  });

  it("parses optional flakeDiagnosis", () => {
    const text = `\`\`\`json
{
  "shouldEditScenario": false,
  "rationale": "Product bug.",
  "changes": [],
  "flakeDiagnosis": {
    "type": "false_negative",
    "confidence": "high",
    "explanation": "Then checked too late."
  }
}
\`\`\``;
    const proposal = extractScenarioFixProposal(text);
    assert.ok(proposal?.flakeDiagnosis);
    assert.equal(proposal!.flakeDiagnosis!.type, "false_negative");
  });
});

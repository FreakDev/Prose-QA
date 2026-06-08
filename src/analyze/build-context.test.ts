import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildScenarioIntent } from "./build-context.js";

describe("buildScenarioIntent", () => {
  it("extracts goal, steps, and then from a scenario file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-intent-"));
    const file = path.join(dir, "demo.md");
    writeFileSync(
      file,
      `---
name: demo-flow
url: http://localhost:3000/invoices
tags: [smoke]
---

# Goal
Verify invoice status can be changed.

# Steps
1. Open the first invoice.
2. Change status to Paid.

# Then
- page shows "Paid"
`,
      "utf-8",
    );

    const intent = buildScenarioIntent(file);
    assert.ok(intent);
    assert.equal(intent!.name, "demo-flow");
    assert.match(intent!.goal, /invoice status/i);
    assert.match(intent!.steps, /Open the first invoice/);
    assert.deepEqual(intent!.then, ['page shows "Paid"']);
  });
});

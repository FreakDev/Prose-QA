import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  expandScenarioLinks,
  isRunnableScenario,
  parseScenarioFile,
  stripScenarioComments,
} from "./parser.js";

describe("stripScenarioComments", () => {
  it("removes YAML full-line and inline comments from frontmatter", () => {
    const raw = `---
name: example-validation-error
# auth: admin
tags: [smoke] # filter tag
url: https://localhost:3000/new
---

# Goal

test goal
`;
    const stripped = stripScenarioComments(raw);
    assert.match(stripped, /name: example-validation-error/);
    assert.doesNotMatch(stripped, /auth: admin/);
    assert.match(stripped, /tags: \[smoke\]/);
    assert.doesNotMatch(stripped, /filter tag/);
  });

  it("removes HTML comments from the body but keeps hash lines", () => {
    const raw = `---
name: example
---

# Goal

verify something

# Steps

1. Do the thing
<!-- author note: skip login when debugging -->
# this step is optional for now
2. Confirm result with option #2

# Then

- url contains "/done"
`;
    const stripped = stripScenarioComments(raw);
    assert.doesNotMatch(stripped, /author note/);
    assert.match(stripped, /optional for now/);
    assert.match(stripped, /option #2/);
    assert.match(stripped, /# Goal/);
    assert.match(stripped, /# Steps/);
    assert.match(stripped, /# Then/);
  });

  it("preserves hash characters mid-line in frontmatter values", () => {
    const raw = `---
name: example
url: "https://example.com#section" # trailing note
---

# Goal

(none)
`;
    const stripped = stripScenarioComments(raw);
    assert.match(stripped, /https:\/\/example\.com#section/);
    assert.doesNotMatch(stripped, /trailing note/);
  });
});

describe("expandScenarioLinks", () => {
  it("inlines body of a linked scenario file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-parser-"));
    const partialPath = path.join(dir, "partial.md");
    const mainPath = path.join(dir, "main.md");

    writeFileSync(
      partialPath,
      `---
name: partial-block
partial: true
---

Fill the client field with **Acme Corp**.
`,
    );
    writeFileSync(
      mainPath,
      `---
name: main-scenario
---

# Steps

1. Open the form
2. [client step](./partial.md)
3. Save
`,
    );

    const scenario = parseScenarioFile(mainPath);
    assert.match(scenario.steps, /Fill the client field with \*\*Acme Corp\*\*/);
    assert.doesNotMatch(scenario.steps, /\[client step\]/);
    assert.match(scenario.steps, /3\. Save/);
  });

  it("expands nested scenario links", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-parser-"));
    const leafPath = path.join(dir, "leaf.md");
    const midPath = path.join(dir, "mid.md");
    const mainPath = path.join(dir, "main.md");

    writeFileSync(
      leafPath,
      `---
name: leaf
partial: true
---

leaf content
`,
    );
    writeFileSync(
      midPath,
      `---
name: mid
partial: true
---

before [leaf](./leaf.md) after
`,
    );
    writeFileSync(
      mainPath,
      `---
name: main
---

# Goal

see [mid](./mid.md)
`,
    );

    const scenario = parseScenarioFile(mainPath);
    assert.match(scenario.goal, /see/);
    assert.match(scenario.goal, /before/);
    assert.match(scenario.goal, /leaf content/);
    assert.match(scenario.goal, /after/);
    assert.doesNotMatch(scenario.goal, /\.md\)/);
  });

  it("leaves non-scenario markdown links unchanged", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-parser-"));
    const mainPath = path.join(dir, "main.md");
    writeFileSync(
      mainPath,
      `---
name: main
---

# Steps

Visit [docs](https://example.com/docs) then continue.
`,
    );

    const scenario = parseScenarioFile(mainPath);
    assert.match(scenario.steps, /\[docs\]\(https:\/\/example\.com\/docs\)/);
  });

  it("throws on circular scenario includes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-parser-"));
    const aPath = path.join(dir, "a.md");
    const bPath = path.join(dir, "b.md");

    writeFileSync(
      aPath,
      `---
name: a
partial: true
---

[a](./b.md)
`,
    );
    writeFileSync(
      bPath,
      `---
name: b
partial: true
---

[b](./a.md)
`,
    );

    assert.throws(() => parseScenarioFile(aPath), /Circular scenario include/);
  });

  it("collects skills from linked scenario frontmatter", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-parser-"));
    const partialPath = path.join(dir, "partial.md");
    const mainPath = path.join(dir, "main.md");

    writeFileSync(
      partialPath,
      `---
name: partial-block
partial: true
skills: [domain-app]
---

Fill the client field.
`,
    );
    writeFileSync(
      mainPath,
      `---
name: main-scenario
skills: [core]
---

# Steps

1. [client step](./partial.md)
`,
    );

    const scenario = parseScenarioFile(mainPath);
    assert.deepEqual(scenario.skills, ["core", "domain-app"]);
  });

  it("deduplicates skills declared in multiple linked scenarios", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pqa-parser-"));
    const sharedPath = path.join(dir, "shared.md");
    const mainPath = path.join(dir, "main.md");

    writeFileSync(
      sharedPath,
      `---
name: shared
partial: true
skills: [core, extra]
---

shared steps
`,
    );
    writeFileSync(
      mainPath,
      `---
name: main
skills: [core, main-only]
---

# Steps

1. [shared](./shared.md)
`,
    );

    const scenario = parseScenarioFile(mainPath);
    assert.deepEqual(scenario.skills, ["core", "main-only", "extra"]);
  });
});

describe("isRunnableScenario", () => {
  it("excludes partial scenarios from batch runs", () => {
    assert.equal(
      isRunnableScenario({
        filePath: "/tmp/x.md",
        frontmatter: { name: "x", partial: true },
        skills: [],
        goal: "",
        steps: "",
        then: [],
        rawCheckpoints: [],
        checkpoints: [],
      }),
      false,
    );
    assert.equal(
      isRunnableScenario({
        filePath: "/tmp/y.md",
        frontmatter: { name: "y" },
        skills: [],
        goal: "",
        steps: "",
        then: [],
        rawCheckpoints: [],
        checkpoints: [],
      }),
      true,
    );
  });
});

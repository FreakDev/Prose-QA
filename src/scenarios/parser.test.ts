import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  expandScenarioLinks,
  isRunnableScenario,
  matchesTags,
  parseScenarioFile,
  stripScenarioComments,
} from "./parser.js";
import type { Scenario } from "../types/scenario.js";

function scenarioWithTags(tags: string[]): Scenario {
  return {
    filePath: "/tmp/x.md",
    frontmatter: { name: "x", tags },
    skills: [],
    goal: "",
    steps: "",
    then: [],
    rawCheckpoints: [],
    checkpoints: [],
  };
}

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

describe("matchesTags", () => {
  it("matches everything when no tag filters are provided", () => {
    assert.equal(matchesTags(scenarioWithTags(["smoke"]), undefined), true);
    assert.equal(matchesTags(scenarioWithTags(["smoke"]), []), true);
  });

  it("requires every tag in a --tags group", () => {
    const scenario = scenarioWithTags(["smoke", "checkout", "critical"]);

    assert.equal(matchesTags(scenario, [["smoke", "checkout"]]), true);
    assert.equal(matchesTags(scenario, [["smoke", "billing"]]), false);
  });

  it("matches any group across repeated --tag filters", () => {
    const scenario = scenarioWithTags(["smoke", "checkout"]);

    assert.equal(matchesTags(scenario, [["billing"], ["checkout"]]), true);
    assert.equal(matchesTags(scenario, [["billing"], ["auth"]]), false);
  });

  it("combines --tags groups and --tag filters with OR semantics", () => {
    const scenario = scenarioWithTags(["smoke", "checkout"]);

    assert.equal(matchesTags(scenario, [["smoke", "admin"], ["checkout"]]), true);
    assert.equal(matchesTags(scenario, [["smoke", "admin"], ["billing"]]), false);
  });

  it("supports negated tags inside --tags AND groups", () => {
    assert.equal(matchesTags(scenarioWithTags(["p0"]), [["p0", "!smoke"]]), true);
    assert.equal(matchesTags(scenarioWithTags(["p0", "smoke"]), [["p0", "!smoke"]]), false);
    assert.equal(matchesTags(scenarioWithTags(["smoke"]), [["p0", "!smoke"]]), false);
  });

  it("supports negated tags across --tag OR groups", () => {
    const filters = [["!p0"], ["smoke"]];

    assert.equal(matchesTags(scenarioWithTags(["smoke"]), filters), true);
    assert.equal(matchesTags(scenarioWithTags(["p0", "smoke"]), filters), true);
    assert.equal(matchesTags(scenarioWithTags(["p0"]), filters), false);
  });

  it("keeps legacy flat tag lists as OR filters", () => {
    const scenario = scenarioWithTags(["smoke"]);

    assert.equal(matchesTags(scenario, ["auth", "smoke"]), true);
    assert.equal(matchesTags(scenario, ["auth", "billing"]), false);
    assert.equal(matchesTags(scenario, ["!p0"]), true);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Scenario } from "../types/scenario.js";
import { hashScenarioContent } from "./hash.js";

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    filePath: "/tmp/example.md",
    frontmatter: { name: "example-smoke" },
    skills: [],
    goal: "Verify the dashboard loads.",
    steps: "1. Open the app.",
    then: ['url contains "/dashboard"'],
    rawCheckpoints: ['url contains "/dashboard"'],
    checkpoints: [
      { raw: 'url contains "/dashboard"', kind: "url_contains", value: "/dashboard" },
    ],
    ...overrides,
  };
}

describe("hashScenarioContent", () => {
  it("is stable for the same expanded content", () => {
    const a = makeScenario();
    const b = makeScenario({ filePath: "/other/path.md" });
    assert.equal(hashScenarioContent(a), hashScenarioContent(b));
  });

  it("changes when steps change", () => {
    const before = makeScenario();
    const after = makeScenario({ steps: "1. Open the app.\n2. Click Save." });
    assert.notEqual(hashScenarioContent(before), hashScenarioContent(after));
  });

  it("changes when then checkpoints change", () => {
    const before = makeScenario();
    const after = makeScenario({
      then: ['page shows "Done"'],
      rawCheckpoints: ['page shows "Done"'],
      checkpoints: [
        { raw: 'page shows "Done"', kind: "page_shows", value: "Done" },
      ],
    });
    assert.notEqual(hashScenarioContent(before), hashScenarioContent(after));
  });
});

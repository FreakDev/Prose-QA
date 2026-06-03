import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Scenario } from "../types/scenario.js";
import type { ScenarioResult } from "../types/verdict.js";
import {
  classifyFailure,
  isRecoveryAllowed,
  isScenarioRetryAllowed,
} from "./classify.js";

const baseConfig = {
  llm: { provider: "anthropic" as const, model: "x" },
  browser: {
    headed: false,
    sessionName: "pqa",
    defaultTimeout: 25_000,
    engine: "chrome" as const,
  },
  skills: { dirs: [], preloads: [] },
  agent: { maxTurns: 30, bashTimeoutMs: 120_000 },
  auth: {},
};

function pilarSmokeScenario(): Scenario {
  return {
    filePath: "/scenarios/pilar-smoke.md",
    frontmatter: { name: "pilar-smoke" },
    skills: [],
    goal: "Smoke test",
    steps: "1. Open app\n5. Open first project",
    then: ['url contains "/projects"', 'page shows "Projects"'],
    rawCheckpoints: ['url contains "/projects"', 'page shows "Projects"'],
    checkpoints: [
      { raw: 'url contains "/projects"', kind: "url_contains", value: "/projects" },
      { raw: 'page shows "Projects"', kind: "page_shows", value: "Projects" },
    ],
  };
}

function pilarSmokeFailResult(): ScenarioResult {
  return {
    scenario: "pilar-smoke",
    filePath: "/scenarios/pilar-smoke.md",
    status: "fail",
    durationMs: 1000,
    verdict: {
      status: "fail",
      summary:
        "All 5 steps completed successfully. However, the final checkpoint fails.",
      checkpoints: [
        {
          assertion: 'url contains "/projects"',
          pass: true,
          reason: "URL contains /projects",
        },
        {
          assertion: 'page shows "Projects"',
          pass: false,
          reason:
            "After completing all steps, the page is on the project detail page. The text 'Projects' does not appear on the current page.",
          evidence: ["snapshot"],
        },
      ],
    },
    transcript: { entries: [] },
  };
}

describe("classifyFailure", () => {
  it("classifies pilar-smoke as scenario_issue", () => {
    const classified = classifyFailure(
      pilarSmokeFailResult(),
      pilarSmokeScenario(),
      baseConfig,
    );
    assert.equal(classified.kind, "scenario_issue");
    assert.equal(classified.confidence, "high");
    assert.ok(classified.signals.includes("steps_completed"));
  });

  it("classifies bash timeout as transient", () => {
    const result: ScenarioResult = {
      scenario: "slow",
      filePath: "/slow.md",
      status: "fail",
      durationMs: 500,
      verdict: {
        status: "fail",
        summary: "Checkpoint failed",
        checkpoints: [
          {
            assertion: 'page shows "Ready"',
            pass: false,
            reason: "Element not found after timeout waiting for selector",
          },
        ],
      },
      transcript: {
        entries: [
          {
            type: "bash",
            command: "agent-browser wait @e1",
            stdout: "",
            stderr: "Timeout waiting for element",
            exitCode: 1,
            durationMs: 25000,
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };
    const classified = classifyFailure(result, undefined, baseConfig);
    assert.equal(classified.kind, "transient");
    assert.ok(classified.signals.some((s) => s.startsWith("bash:")));
  });

  it("classifies product business rule failures", () => {
    const result: ScenarioResult = {
      scenario: "incomplete-client",
      filePath: "/incomplete.md",
      status: "fail",
      durationMs: 500,
      verdict: {
        status: "fail",
        summary: "Add Invoices button disabled as expected",
        checkpoints: [
          {
            assertion: 'button "Add Invoices" is disabled',
            pass: false,
            reason:
              "Complete the client profile before adding invoices. Button is disabled.",
          },
        ],
      },
      transcript: { entries: [] },
    };
    const classified = classifyFailure(result, undefined, baseConfig);
    assert.equal(classified.kind, "product");
  });

  it("does not allow recovery for scenario_issue", () => {
    const classified = classifyFailure(
      pilarSmokeFailResult(),
      pilarSmokeScenario(),
      baseConfig,
    );
    assert.equal(isRecoveryAllowed(classified, baseConfig), false);
    assert.equal(
      isScenarioRetryAllowed(classified, "transient", baseConfig),
      false,
    );
  });

  it("allows scenario retry for transient under transient policy", () => {
    const result: ScenarioResult = {
      scenario: "flake",
      filePath: "/flake.md",
      status: "fail",
      durationMs: 100,
      verdict: {
        status: "fail",
        summary: "fail",
        checkpoints: [
          {
            assertion: 'page shows "X"',
            pass: false,
            reason: "Timeout waiting for network idle",
          },
        ],
      },
      transcript: {
        entries: [
          {
            type: "bash",
            command: "agent-browser wait --load networkidle",
            stdout: "",
            stderr: "timeout",
            exitCode: 1,
            durationMs: 1000,
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };
    const classified = classifyFailure(result, undefined, baseConfig);
    assert.equal(classified.kind, "transient");
    assert.equal(isRecoveryAllowed(classified, baseConfig), true);
    assert.equal(
      isScenarioRetryAllowed(classified, "transient", baseConfig),
      true,
    );
  });

  it("retries all failures when retriesPolicy is always", () => {
    const classified = classifyFailure(
      pilarSmokeFailResult(),
      pilarSmokeScenario(),
      baseConfig,
    );
    assert.equal(
      isScenarioRetryAllowed(classified, "always", baseConfig),
      true,
    );
  });
});

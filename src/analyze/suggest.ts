import type { ClassifiedFailure } from "../healing/classify.js";
import type { Scenario } from "../types/scenario.js";
import type { ScenarioResult } from "../types/verdict.js";

function lastNumberedStepIndex(steps: string): number | undefined {
  const matches = [...steps.matchAll(/^\s*(\d+)\./gm)];
  if (matches.length === 0) return undefined;
  const last = matches.at(-1);
  return last ? parseInt(last[1]!, 10) : undefined;
}

function stepBeforeNavigation(scenario: Scenario): number | undefined {
  const lines = scenario.steps.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.toLowerCase();
    if (
      /open (the )?(first )?project\b|open (a )?project\b|navigate.*project.*detail|see details/i.test(
        line,
      ) &&
      !/my projects|all projects|projects list|sidebar/i.test(line)
    ) {
      const prev = lines
        .slice(0, i)
        .map((l) => /^\s*(\d+)\./.exec(l))
        .filter(Boolean)
        .at(-1);
      if (prev) return parseInt(prev[1]!, 10);
      return Math.max(1, i);
    }
  }
  return lastNumberedStepIndex(scenario.steps);
}

export function suggestScenarioFixes(
  result: ScenarioResult,
  scenario: Scenario | undefined,
  classified: ClassifiedFailure,
): string[] {
  const suggestions: string[] = [];
  const failed = result.verdict?.checkpoints.filter((c) => !c.pass) ?? [];

  switch (classified.kind) {
    case "scenario_issue": {
      for (const cp of failed) {
        if (/^page shows/i.test(cp.assertion)) {
          const stepN = scenario ? stepBeforeNavigation(scenario) : undefined;
          if (stepN !== undefined) {
            suggestions.push(
              `Move checkpoint "${cp.assertion}" to immediately after step ${stepN} (before navigation changes the page).`,
            );
          } else {
            suggestions.push(
              `Add an intermediate Then with "${cp.assertion}" before the step that navigates away from that view.`,
            );
          }
        }
        if (/^url contains/i.test(cp.assertion) && /detail/i.test(cp.reason)) {
          suggestions.push(
            `Narrow "${cp.assertion}" to the list route only (e.g. exact path "/projects" without project id), or verify URL before opening a detail page.`,
          );
        }
      }
      if (suggestions.length === 0) {
        suggestions.push(
          "Review Then placement: checkpoints may target an earlier page state than the final step leaves the browser on.",
        );
      }
      break;
    }
    case "transient": {
      if (classified.signals.length > 0) {
        suggestions.push(
          `Flake suspected (signals: ${classified.signals.join(", ")}). Add explicit waits after steps that trigger navigation or data loading.`,
        );
      } else {
        suggestions.push(
          "Flake suspected — add agent-browser wait commands after unstable steps.",
        );
      }
      suggestions.push(
        "Consider `pqa run ... --retries 1 --retries-policy transient` for CI.",
      );
      break;
    }
    case "product": {
      for (const cp of failed) {
        suggestions.push(
          `Likely application regression — do not heal. Failed: "${cp.assertion}" — ${cp.reason.slice(0, 120)}`,
        );
      }
      break;
    }
    default: {
      suggestions.push(
        `Review transcript and artifacts in ${result.artifactDir ?? "(no artifact dir)"}.`,
      );
      if (result.error) {
        suggestions.push(`Error: ${result.error.slice(0, 200)}`);
      }
    }
  }

  return suggestions.slice(0, 5);
}

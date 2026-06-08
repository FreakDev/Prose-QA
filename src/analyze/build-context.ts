import { readFileSync } from "node:fs";
import path from "node:path";
import { parseScenarioFile } from "../scenarios/parser.js";
import type { AnalyzeFinding } from "./index.js";
import type { ScenarioResult, TranscriptEntry } from "../types/verdict.js";

const MAX_TRANSCRIPT_ENTRIES = 28;
const MAX_STDOUT_CHARS = 1500;
const MAX_MESSAGE_CHARS = 2000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export interface ScenarioIntentContext {
  name: string;
  url?: string;
  auth?: string;
  tags?: string[];
  goal: string;
  steps: string;
  then: string[];
}

export interface LlmAnalyzeContext {
  heuristicFinding: AnalyzeFinding;
  scenarioIntent: ScenarioIntentContext | null;
  scenarioResult: {
    scenario: string;
    filePath: string;
    status: string;
    error?: string;
    verdict: ScenarioResult["verdict"];
    transcript: {
      entries: TranscriptEntry[];
    };
    healing?: ScenarioResult["healing"];
  };
  scenarioMarkdown: string;
}

export function buildScenarioIntent(
  filePath: string,
): ScenarioIntentContext | null {
  try {
    const scenario = parseScenarioFile(filePath);
    return {
      name: scenario.frontmatter.name,
      url: scenario.frontmatter.url,
      auth: scenario.frontmatter.auth,
      tags: scenario.frontmatter.tags,
      goal: scenario.goal,
      steps: scenario.steps,
      then: scenario.then,
    };
  } catch {
    return null;
  }
}

export function buildLlmAnalyzeContext(
  finding: AnalyzeFinding,
  result: ScenarioResult,
  cwd: string,
): LlmAnalyzeContext {
  const scenarioPath = path.isAbsolute(result.filePath)
    ? result.filePath
    : path.resolve(cwd, result.filePath);

  const scenarioMarkdown = readFileSync(scenarioPath, "utf-8");
  const scenarioIntent = buildScenarioIntent(scenarioPath);

  const entries = result.transcript.entries
    .slice(-MAX_TRANSCRIPT_ENTRIES)
    .map((entry): TranscriptEntry => {
      if (entry.type === "message") {
        return {
          type: "message",
          role: entry.role,
          content: truncate(entry.content, MAX_MESSAGE_CHARS),
          ...(entry.thinking
            ? { thinking: truncate(entry.thinking, MAX_MESSAGE_CHARS) }
            : {}),
        };
      }
      return {
        type: "bash",
        command: entry.command,
        exitCode: entry.exitCode,
        stdout: truncate(entry.stdout, MAX_STDOUT_CHARS),
        stderr: truncate(entry.stderr, 500),
        durationMs: entry.durationMs,
      };
    });

  return {
    heuristicFinding: finding,
    scenarioIntent,
    scenarioResult: {
      scenario: result.scenario,
      filePath: result.filePath,
      status: result.status,
      error: result.error,
      verdict: result.verdict,
      transcript: { entries },
      healing: result.healing,
    },
    scenarioMarkdown,
  };
}

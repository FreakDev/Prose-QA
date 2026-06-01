import { readFileSync } from "node:fs";
import { generateText } from "ai";
import type { PqaConfig } from "../types/config.js";
import { createLlmModel } from "../agent/llm-model.js";
import { resolveBundledPath } from "../paths.js";
import type { FlakyLlmAnalyzeContext, LlmAnalyzeContext } from "./build-context.js";
import {
  extractScenarioFixProposal,
  type ScenarioFixProposal,
} from "./parse-proposal.js";
import { validateScenarioMarkdown } from "./validate-markdown.js";

export interface LlmFixResult {
  proposal: ScenarioFixProposal | null;
  rawText: string;
  parseError?: string;
}

async function validateAndRetryProposal(
  config: PqaConfig,
  system: string,
  formatRef: string,
  proposal: ScenarioFixProposal,
  rawText: string,
): Promise<LlmFixResult> {
  if (!proposal.shouldEditScenario) {
    return { proposal, rawText };
  }

  const markdown = proposal.revisedMarkdown?.trim();
  if (!markdown) {
    return {
      proposal,
      rawText,
      parseError: "shouldEditScenario is true but revisedMarkdown is missing",
    };
  }

  try {
    validateScenarioMarkdown(markdown);
    return { proposal, rawText };
  } catch (err) {
    const parseError = `revisedMarkdown failed parse: ${String(err)}`;
    const retry = await generateText({
      model: createLlmModel(config),
      system: `${system}\n\n---\n\n## Reference: scenario format\n\n${formatRef}`,
      prompt: `The revised scenario failed to parse: ${parseError}\n\nReturn ONLY fixed JSON with valid revisedMarkdown.\n\nPrevious JSON:\n\`\`\`json\n${JSON.stringify(proposal, null, 2)}\n\`\`\``,
      maxOutputTokens: 8192,
    });

    const retried = extractScenarioFixProposal(retry.text);
    if (!retried?.shouldEditScenario || !retried.revisedMarkdown?.trim()) {
      return { proposal, rawText: retry.text, parseError };
    }

    try {
      validateScenarioMarkdown(retried.revisedMarkdown);
      return { proposal: retried, rawText: retry.text };
    } catch (retryErr) {
      return {
        proposal: retried,
        rawText: retry.text,
        parseError: `revisedMarkdown failed parse after retry: ${String(retryErr)}`,
      };
    }
  }
}

async function runLlmProposal(
  config: PqaConfig,
  cwd: string,
  systemRelPath: string,
  userPrompt: string,
): Promise<LlmFixResult> {
  const systemPath = resolveBundledPath(cwd, systemRelPath);
  const formatPath = resolveBundledPath(
    cwd,
    "prompt/references/scenario-format.md",
  );
  const system = readFileSync(systemPath, "utf-8");
  const formatRef = readFileSync(formatPath, "utf-8");
  const fullSystem = `${system}\n\n---\n\n## Reference: scenario format\n\n${formatRef}`;

  const { text } = await generateText({
    model: createLlmModel(config),
    system: fullSystem,
    prompt: userPrompt,
    maxOutputTokens: 8192,
  });

  const proposal = extractScenarioFixProposal(text);
  if (!proposal) {
    return {
      proposal: null,
      rawText: text,
      parseError: "LLM response did not contain valid proposal JSON",
    };
  }

  return validateAndRetryProposal(config, system, formatRef, proposal, text);
}

export async function proposeScenarioFixWithLlm(
  config: PqaConfig,
  context: LlmAnalyzeContext,
  cwd: string,
): Promise<LlmFixResult> {
  return runLlmProposal(
    config,
    cwd,
    "prompt/ANALYZE.md",
    `Analyze this failed run and propose scenario fixes.\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nReply with ONLY the JSON code block from the output schema.`,
  );
}

export async function proposeFlakyScenarioFixWithLlm(
  config: PqaConfig,
  context: FlakyLlmAnalyzeContext,
  cwd: string,
): Promise<LlmFixResult> {
  return runLlmProposal(
    config,
    cwd,
    "prompt/ANALYZE-FLAKY.md",
    `Compare pass vs fail runs for this flaky scenario and propose stabilizing edits.\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nReply with ONLY the JSON code block from the output schema.`,
  );
}

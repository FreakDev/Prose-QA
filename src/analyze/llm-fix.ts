import { readFileSync } from "node:fs";
import { generateText } from "ai";
import type { PqaConfig } from "../types/config.js";
import { createLlmModel } from "../agent/llm-model.js";
import { resolveBundledPath } from "../paths.js";
import type { LlmAnalyzeContext } from "./build-context.js";
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

export async function proposeScenarioFixWithLlm(
  config: PqaConfig,
  context: LlmAnalyzeContext,
  cwd: string,
): Promise<LlmFixResult> {
  const systemPath = resolveBundledPath(cwd, "prompt/ANALYZE.md");
  const formatPath = resolveBundledPath(
    cwd,
    "prompt/references/scenario-format.md",
  );
  const system = readFileSync(systemPath, "utf-8");
  const formatRef = readFileSync(formatPath, "utf-8");

  const { text } = await generateText({
    model: createLlmModel(config),
    system: `${system}\n\n---\n\n## Reference: scenario format\n\n${formatRef}`,
    prompt: `Analyze this failed run and propose scenario fixes.\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nReply with ONLY the JSON code block from the output schema.`,
    maxOutputTokens: 8192,
  });

  let proposal = extractScenarioFixProposal(text);
  let parseError: string | undefined;

  if (!proposal) {
    parseError = "LLM response did not contain valid proposal JSON";
    return { proposal: null, rawText: text, parseError };
  }

  if (proposal.shouldEditScenario) {
    const markdown = proposal.revisedMarkdown?.trim();
    if (!markdown) {
      parseError = "shouldEditScenario is true but revisedMarkdown is missing";
      return { proposal, rawText: text, parseError };
    }

    try {
      validateScenarioMarkdown(markdown);
    } catch (err) {
      parseError = `revisedMarkdown failed parse: ${String(err)}`;
      const retry = await generateText({
        model: createLlmModel(config),
        system: `${system}\n\n---\n\n## Reference: scenario format\n\n${formatRef}`,
        prompt: `The revised scenario failed to parse: ${parseError}\n\nReturn ONLY fixed JSON with valid revisedMarkdown.\n\nPrevious JSON:\n\`\`\`json\n${JSON.stringify(proposal, null, 2)}\n\`\`\``,
        maxOutputTokens: 8192,
      });

      const retried = extractScenarioFixProposal(retry.text);
      if (!retried?.shouldEditScenario || !retried.revisedMarkdown?.trim()) {
        return {
          proposal,
          rawText: retry.text,
          parseError,
        };
      }

      try {
        validateScenarioMarkdown(retried.revisedMarkdown);
        proposal = retried;
        parseError = undefined;
      } catch (retryErr) {
        parseError = `revisedMarkdown failed parse after retry: ${String(retryErr)}`;
        proposal = retried;
      }
    }
  }

  return { proposal, rawText: text, parseError };
}

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { createLlmModel } from "../agent/llm-model.js";
import type { PqaConfig } from "../types/config.js";
import { resolveBundledPath } from "../paths.js";
import { parseScenarioFile, stripScenarioComments } from "../scenarios/parser.js";
import { unlinkSync } from "node:fs";
import { readEvents, readMeta } from "./events.js";
import { resolveRecorderConfig } from "./session.js";

function extractMarkdown(text: string): string {
  const fenced = /```(?:markdown|md)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) return fenced[1]!.trim();
  return text.trim();
}

export interface GenerateScenarioOptions {
  config: PqaConfig;
  recordingDir: string;
  cwd: string;
  scenarioName: string;
  outputPath: string;
}

export interface GenerateScenarioResult {
  markdown: string;
  outputPath: string;
  parseError?: string;
}

export async function generateScenarioFromRecording(
  options: GenerateScenarioOptions,
): Promise<GenerateScenarioResult> {
  const meta = readMeta(options.recordingDir);
  const events = readEvents(options.recordingDir);
  const recorder = resolveRecorderConfig(options.config.recorder);

  const systemPath = resolveBundledPath(options.cwd, "prompt/RECORD.md");
  const formatPath = resolveBundledPath(
    options.cwd,
    "prompt/references/scenario-format.md",
  );
  const system = readFileSync(systemPath, "utf-8");
  const formatRef = readFileSync(formatPath, "utf-8");

  const userPayload = {
    scenarioName: options.scenarioName,
    defaultTags: recorder.defaultTags,
    meta,
    events,
  };

  const { text } = await generateText({
    model: createLlmModel(options.config),
    system: `${system}\n\n---\n\n## Reference: scenario format\n\n${formatRef}`,
    prompt: `Generate a Prose-QA scenario markdown file from this recording.\n\n\`\`\`json\n${JSON.stringify(userPayload, null, 2)}\n\`\`\`\n\nReply with ONLY the complete scenario markdown file.`,
    maxOutputTokens: 8192,
  });

  let markdown = extractMarkdown(text);
  let parseError: string | undefined;

  const validate = (md: string): void => {
    const draft = path.join(options.recordingDir, ".draft-scenario.md");
    writeFileSync(draft, `${stripScenarioComments(md).trim()}\n`, "utf-8");
    try {
      parseScenarioFile(draft);
    } finally {
      try {
        unlinkSync(draft);
      } catch {
        /* ignore */
      }
    }
  };

  try {
    validate(markdown);
  } catch (err) {
    parseError = String(err);
    const retry = await generateText({
      model: createLlmModel(options.config),
      system: `${system}\n\n---\n\n## Reference: scenario format\n\n${formatRef}`,
      prompt: `The previous scenario failed to parse: ${parseError}\n\nFix and return ONLY valid markdown.\n\nPrevious:\n\`\`\`markdown\n${markdown}\n\`\`\``,
      maxOutputTokens: 8192,
    });
    markdown = extractMarkdown(retry.text);
    validate(markdown);
    parseError = undefined;
  }

  writeFileSync(options.outputPath, `${markdown.trim()}\n`, "utf-8");

  return {
    markdown,
    outputPath: options.outputPath,
    parseError,
  };
}

export function defaultOutputPath(
  cwd: string,
  scenarioName: string,
): string {
  return path.join(cwd, "scenarios", "recorded", `${scenarioName}.md`);
}

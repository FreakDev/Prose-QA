import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { SaqConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import type {
  AgentTranscript,
  ScenarioResult,
  Verdict,
} from "../types/verdict.js";
import { buildBrowserEnv, readFileTool, runBash } from "./bash.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendTranscriptMessage, extractVerdict } from "./verdict.js";
import { fireworks } from "@ai-sdk/fireworks";

const MAX_VERDICT_RETRIES = 5;
const VERDICT_RETRY_PROMPT =
  "Your previous response did not contain valid verdict JSON. Reply with only a ```json code block matching the verdict schema from the system prompt.";

function appendFinalTextToTranscript(
  transcript: AgentTranscript,
  finalText: string,
): void {
  if (!finalText) return;
  const last = transcript.messages.at(-1);
  if (last?.role === "assistant" && last.content === finalText) return;
  appendTranscriptMessage(transcript, "assistant", finalText);
}

function removeLastAssistantMessage(transcript: AgentTranscript): void {
  const last = transcript.messages.at(-1);
  if (last?.role === "assistant") {
    transcript.messages.pop();
  }
}

function createModel(config: SaqConfig) {
  if (config.llm.provider === "openai") {
    return openai(config.llm.model);
  }
  if (config.llm.provider === "fireworks") {
    return fireworks(config.llm.model);
  }
  return anthropic(config.llm.model);
}

export interface RunScenarioOptions {
  config: SaqConfig;
  skills: Skill[];
  scenario: Scenario;
  cwd: string;
  baseUrl: string;
  artifactDir: string;
  authStatePath?: string;
  headed: boolean;
  verbose?: boolean;
  onTurn?: () => Promise<void>;
}

export async function runScenario(
  options: RunScenarioOptions,
): Promise<ScenarioResult> {
  const start = Date.now();
  const transcript: AgentTranscript = { messages: [], bash: [] };
  const sessionName = options.config.browser.sessionName;
  const bashEnv = buildBrowserEnv({
    headed: options.headed,
    sessionName,
    authStatePath: options.authStatePath,
    artifactDir: options.artifactDir,
    baseUrl: options.baseUrl,
  });

  const system = buildSystemPrompt(
    options.config,
    options.skills,
    options.scenario,
    {
      cwd: options.cwd,
      baseUrl: options.baseUrl,
      artifactDir: options.artifactDir,
      authStatePath: options.authStatePath,
      headed: options.headed,
      sessionName,
    },
  );

  let finalText = "";
  let turn = 0;

  const tools = {
    bash: tool({
      description:
        "Run a bash command. Use agent-browser for browser automation.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        const entry = await runBash(command, {
          cwd: options.cwd,
          timeoutMs: options.config.agent.bashTimeoutMs,
          env: bashEnv,
        });
        transcript.bash.push(entry);
        if (options.verbose) {
          console.log(`\n$ ${command}`);
          if (entry.stdout) console.log(entry.stdout.slice(0, 2000));
          if (entry.stderr) console.error(entry.stderr.slice(0, 1000));
        }
        return {
          exitCode: entry.exitCode,
          stdout: entry.stdout.slice(0, 8000),
          stderr: entry.stderr.slice(0, 2000),
        };
      },
    }),
    read: tool({
      description: "Read a file from the project directory",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: filePath }) => {
        const result = readFileTool(filePath, options.cwd);
        if ("error" in result) return { error: result.error };
        return { content: result.content.slice(0, 12000) };
      },
    }),
  };

  const onStepFinish = async ({ text }: { text: string }) => {
    turn += 1;
    if (text) {
      appendTranscriptMessage(transcript, "assistant", text);
      finalText = text;
    }
    if (options.onTurn) await options.onTurn();
  };

  try {
    let result = await generateText({
      model: createModel(options.config),
      system,
      prompt: `Execute the scenario "${options.scenario.frontmatter.name}" now. Start by opening ${options.baseUrl} with agent-browser.`,
      tools,
      stopWhen: stepCountIs(options.config.agent.maxTurns),
      onStepFinish,
    });

    finalText = result.text || finalText;
    appendFinalTextToTranscript(transcript, finalText);

    let verdict = extractVerdict(finalText);

    for (
      let attempt = 0;
      !verdict && attempt < MAX_VERDICT_RETRIES;
      attempt++
    ) {
      removeLastAssistantMessage(transcript);
      appendTranscriptMessage(transcript, "user", VERDICT_RETRY_PROMPT);

      const retryMessages: ModelMessage[] = [
        ...result.response.messages,
        { role: "user", content: VERDICT_RETRY_PROMPT },
      ];

      result = await generateText({
        model: createModel(options.config),
        system,
        messages: retryMessages,
        stopWhen: stepCountIs(1),
        onStepFinish,
      });

      finalText = result.text || finalText;
      appendFinalTextToTranscript(transcript, finalText);
      verdict = extractVerdict(finalText);
    }
    const status = verdict?.status === "pass" ? "pass" : "fail";

    return {
      scenario: options.scenario.frontmatter.name,
      filePath: options.scenario.filePath,
      status: verdict ? status : "fail",
      durationMs: Date.now() - start,
      verdict,
      transcript,
      artifactDir: options.artifactDir,
      error: verdict
        ? undefined
        : "Agent did not emit a valid verdict JSON block",
    };
  } catch (err) {
    return {
      scenario: options.scenario.frontmatter.name,
      filePath: options.scenario.filePath,
      status: "error",
      durationMs: Date.now() - start,
      verdict: null,
      transcript,
      artifactDir: options.artifactDir,
      error: String(err),
    };
  }
}

export async function runAuthSave(options: {
  config: SaqConfig;
  skills: Skill[];
  cwd: string;
  authName: string;
  loginUrl: string;
  statePath: string;
  headed: boolean;
  verbose?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const transcript: AgentTranscript = { messages: [], bash: [] };
  const bashEnv = buildBrowserEnv({
    headed: options.headed,
    sessionName: `saq-auth-${options.authName}`,
    artifactDir: options.cwd,
    baseUrl: options.loginUrl,
  });

  const { buildAuthPrompt } = await import("./prompt.js");

  try {
    await generateText({
      model: createModel(options.config),
      system: buildAuthPrompt(
        options.config,
        options.skills,
        options.authName,
        options.loginUrl,
        options.statePath,
      ),
      prompt: `Open ${options.loginUrl} and complete login. Save state to ${options.statePath}.`,
      tools: {
        bash: tool({
          description: "Run a bash command",
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            const entry = await runBash(command, {
              cwd: options.cwd,
              timeoutMs: options.config.agent.bashTimeoutMs,
              env: bashEnv,
            });
            transcript.bash.push(entry);
            if (options.verbose) console.log(`$ ${command}`);
            return {
              exitCode: entry.exitCode,
              stdout: entry.stdout.slice(0, 8000),
              stderr: entry.stderr.slice(0, 2000),
            };
          },
        }),
      },
      stopWhen: stepCountIs(20),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export type { Verdict };

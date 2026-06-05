import {
  generateText,
  Output,
  stepCountIs,
  tool,
  type GenerateTextResult,
  type ModelMessage,
  type ToolSet,
} from "ai";

type TextGenerateOutput = ReturnType<typeof Output.text>;
import { z } from "zod";
import type { ArtifactsMode, PqaConfig } from "../types/config.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import type {
  AgentTranscript,
  BashEntry,
  HealingMeta,
  ScenarioResult,
  Verdict,
} from "../types/verdict.js";
import { resolveHealingConfig } from "../config/load.js";
import {
  classifyFailure,
  isHealingEnabled,
  isRecoveryAllowed,
} from "../healing/classify.js";
import { buildRecoveryPrompt } from "../healing/recovery-prompt.js";
import { buildBrowserEnv, runBash } from "./bash.js";
import { buildInitialPrompt, buildSystemPrompt } from "./prompt.js";
import { buildVerdictRetryPrompt } from "./verdict-retry-prompt.js";
import { persistTranscript } from "./transcript-persist.js";
import {
  appendFinalTextToTranscript,
  appendStepToTranscript,
  appendTranscriptMessage,
  extractVerdict,
  formatStepForTranscript,
  stripLastAssistantTurn,
} from "./verdict.js";
import { resolveStatePath } from "../auth/store.js";
import type { EnvRedactor } from "../redact/env-secrets.js";
import { createLlmModel } from "./llm-model.js";
import { buildProviderOptions } from "./provider-options.js";

const MAX_VERDICT_RETRIES = 5;
/** Extra steps when re-emitting a verdict after an invalid completion. */
const VERDICT_RETRY_MAX_STEPS = 10;

function removeLastAssistantMessage(transcript: AgentTranscript): void {
  while (transcript.entries.at(-1)?.type === "bash") {
    transcript.entries.pop();
  }
  const last = transcript.entries.at(-1);
  if (last?.type === "message" && last.role === "assistant") {
    transcript.entries.pop();
  }
}

export interface RunScenarioOptions {
  config: PqaConfig;
  skills: Skill[];
  scenario: Scenario;
  cwd: string;
  artifactDir: string;
  authStatePath?: string;
  authProfile?: string;
  profilePath?: string;
  headed: boolean;
  verbose?: boolean;
  artifacts: ArtifactsMode;
  sessionName?: string;
  preparedStartUrl?: string;
  onTurn?: () => Promise<void>;
  redactor?: EnvRedactor;
  noHealing?: boolean;
  scenarioCacheHints?: string;
}

async function retryVerdictCompletion(options: {
  config: PqaConfig;
  system: string;
  providerOptions: ReturnType<typeof buildProviderOptions>;
  result: GenerateTextResult<ToolSet, TextGenerateOutput>;
  transcript: AgentTranscript;
  runOptions: RunScenarioOptions;
  onStepFinish: (step: {
    text: string;
    reasoningText?: string;
    toolCalls: Array<{ toolName: string; input: unknown }>;
  }) => Promise<void>;
  finalText: string;
  stepTiming: { startMs: number };
}): Promise<{
  result: GenerateTextResult<ToolSet, TextGenerateOutput>;
  finalText: string;
}> {
  let { result, finalText } = options;

  for (
    let attempt = 0;
    !extractVerdict(finalText) && attempt < MAX_VERDICT_RETRIES;
    attempt++
  ) {
    removeLastAssistantMessage(options.transcript);

    const retryPrompt = buildVerdictRetryPrompt(options.runOptions.scenario);
    appendTranscriptMessage(options.transcript, "user", retryPrompt);
    persistTranscript(options.runOptions, options.transcript);

    const retryMessages: ModelMessage[] = [
      ...stripLastAssistantTurn(result.response.messages as ModelMessage[]),
      { role: "user", content: retryPrompt },
    ];

    options.stepTiming.startMs = Date.now();
    result = await generateText({
      model: createLlmModel(options.config),
      system: options.system,
      messages: retryMessages,
      providerOptions: options.providerOptions,
      stopWhen: stepCountIs(VERDICT_RETRY_MAX_STEPS),
      onStepFinish: options.onStepFinish,
    });

    finalText = result.text || finalText;
    appendFinalTextToTranscript(
      options.transcript,
      options.runOptions.redactor
        ? options.runOptions.redactor.redact(finalText)
        : finalText,
      { durationMs: Date.now() - options.stepTiming.startMs },
    );
    options.stepTiming.startMs = Date.now();
    persistTranscript(options.runOptions, options.transcript);
  }

  return { result, finalText };
}

export async function runScenario(
  options: RunScenarioOptions,
): Promise<ScenarioResult> {
  const start = Date.now();
  const transcript: AgentTranscript = { entries: [] };
  const sessionName =
    options.sessionName ?? options.config.browser.sessionName;
  const authSavePath = options.authProfile
    ? resolveStatePath(options.cwd, options.authProfile, options.config)
    : undefined;
  const bashEnv = buildBrowserEnv({
    cwd: options.cwd,
    headed: options.headed,
    sessionName,
    engine: options.config.browser.engine,
    lightpanda: options.config.browser.lightpanda,
    profilePath: options.profilePath,
    authStatePath: options.profilePath ? undefined : options.authStatePath,
    authSavePath,
    artifactDir: options.artifactDir,
  });

  const system = buildSystemPrompt(
    options.config,
    options.skills,
    options.scenario,
    {
      cwd: options.cwd,
      artifactDir: options.artifactDir,
      authStatePath: options.authStatePath,
      authProfile: options.authProfile,
      profilePath: options.profilePath,
      headed: options.headed,
      sessionName,
      artifacts: options.artifacts,
      scenarioCacheHints: options.scenarioCacheHints,
      preparedStartUrl: options.preparedStartUrl,
    },
  );

  let finalText = "";
  let turn = 0;
  const stepTiming = { startMs: Date.now() };
  const pendingBashEntries: BashEntry[] = [];

  const tools = {
    bash: tool({
      description:
        "Run ONE bash command. For UI interactions (click, fill, select, open, press), run a single agent-browser command per call. Use snapshot -i before acting on refs.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        const entry = await runBash(command, {
          cwd: options.cwd,
          timeoutMs: options.config.agent.bashTimeoutMs,
          env: bashEnv,
        });
        const redacted = options.redactor
          ? options.redactor.redactBashEntry(entry)
          : entry;
        pendingBashEntries.push(redacted);
        if (options.verbose) {
          console.log(`\n$ ${redacted.command}`);
          if (redacted.stdout) console.log(redacted.stdout.slice(0, 2000));
          if (redacted.stderr) console.error(redacted.stderr.slice(0, 1000));
        }
        return {
          exitCode: entry.exitCode,
          stdout: entry.stdout.slice(0, 8000),
          stderr: entry.stderr.slice(0, 2000),
        };
      },
    }),
  };

  const initialPrompt = buildInitialPrompt(
    options.scenario,
    options.preparedStartUrl,
  );
  appendTranscriptMessage(transcript, "user", initialPrompt);
  persistTranscript(options, transcript);

  const onStepFinish = async (step: {
    text: string;
    reasoningText?: string;
    toolCalls: Array<{ toolName: string; input: unknown }>;
  }) => {
    turn += 1;
    const recordedAt = new Date();
    const durationMs = recordedAt.getTime() - stepTiming.startMs;
    stepTiming.startMs = recordedAt.getTime();
    const bashEntries = pendingBashEntries.splice(0);
    const stepInput = {
      text: step.text,
      reasoningText: step.reasoningText,
      toolCalls: step.toolCalls,
    };
    const formatted = formatStepForTranscript(stepInput);
    const safeFormatted = options.redactor
      ? {
        content: formatted.content
          ? options.redactor.redact(formatted.content)
          : formatted.content,
        thinking: formatted.thinking
          ? options.redactor.redact(formatted.thinking)
          : formatted.thinking,
      }
      : formatted;
    const changed = appendStepToTranscript(
      transcript,
      stepInput,
      bashEntries,
      safeFormatted,
      { at: recordedAt, durationMs },
    );
    if (changed) {
      persistTranscript(options, transcript);
    }
    if (step.text) finalText = step.text;
    if (options.onTurn) await options.onTurn();
  };

  try {
    const providerOptions = buildProviderOptions(options.config);

    stepTiming.startMs = Date.now();
    let result = (await generateText({
      model: createLlmModel(options.config),
      system,
      prompt: initialPrompt,
      tools,
      providerOptions,
      stopWhen: stepCountIs(options.config.agent.maxTurns),
      onStepFinish,
    })) as unknown as GenerateTextResult<ToolSet, TextGenerateOutput>;

    finalText = result.text || finalText;
    appendFinalTextToTranscript(
      transcript,
      options.redactor ? options.redactor.redact(finalText) : finalText,
      { durationMs: Date.now() - stepTiming.startMs },
    );
    stepTiming.startMs = Date.now();
    persistTranscript(options, transcript);

    ({ result, finalText } = await retryVerdictCompletion({
      config: options.config,
      system,
      providerOptions,
      result,
      transcript,
      runOptions: options,
      onStepFinish,
      finalText,
      stepTiming,
    }));

    let verdict = extractVerdict(finalText);

    const healingMeta: HealingMeta = {
      used: false,
      recoveryTurns: 0,
      scenarioRetries: 0,
    };

    let draftResult: ScenarioResult = {
      scenario: options.scenario.frontmatter.name,
      filePath: options.scenario.filePath,
      status: verdict?.status === "pass" ? "pass" : "fail",
      durationMs: Date.now() - start,
      verdict: options.redactor ? options.redactor.redactVerdict(verdict) : verdict,
      transcript,
      artifactDir: options.artifactDir,
      error: verdict
        ? undefined
        : "Agent did not emit a valid verdict JSON block",
      healing: healingMeta,
    };

    if (
      isHealingEnabled(options.config, options.noHealing) &&
      verdict?.status === "fail"
    ) {
      const classified = classifyFailure(
        draftResult,
        options.scenario,
        options.config,
      );
      healingMeta.failureKind = classified.kind;
      healingMeta.signals = classified.signals;

      if (isRecoveryAllowed(classified, options.config, options.noHealing)) {
        const maxRecovery = resolveHealingConfig(options.config).maxRecoveryTurns;
        const failed = verdict.checkpoints.filter((c) => !c.pass);

        for (let recoveryAttempt = 0; recoveryAttempt < maxRecovery; recoveryAttempt++) {
          const recoveryPrompt = buildRecoveryPrompt(failed);
          appendTranscriptMessage(transcript, "user", recoveryPrompt);
          persistTranscript(options, transcript);

          const recoveryMessages: ModelMessage[] = [
            ...result.response.messages,
            { role: "user", content: recoveryPrompt },
          ];

          stepTiming.startMs = Date.now();
          result = (await generateText({
            model: createLlmModel(options.config),
            system,
            messages: recoveryMessages,
            tools,
            providerOptions,
            stopWhen: stepCountIs(options.config.agent.maxTurns),
            onStepFinish,
          })) as unknown as GenerateTextResult<ToolSet, TextGenerateOutput>;

          finalText = result.text || finalText;
          appendFinalTextToTranscript(
            transcript,
            options.redactor ? options.redactor.redact(finalText) : finalText,
            { durationMs: Date.now() - stepTiming.startMs },
          );
          stepTiming.startMs = Date.now();
          persistTranscript(options, transcript);

          ({ result, finalText } = await retryVerdictCompletion({
            config: options.config,
            system,
            providerOptions,
            result,
            transcript,
            runOptions: options,
            onStepFinish,
            finalText,
            stepTiming,
          }));
          verdict = extractVerdict(finalText);

          healingMeta.recoveryTurns += 1;

          draftResult = {
            ...draftResult,
            status: verdict?.status === "pass" ? "pass" : "fail",
            verdict: options.redactor
              ? options.redactor.redactVerdict(verdict)
              : verdict,
            error: verdict
              ? undefined
              : "Agent did not emit a valid verdict JSON block",
          };

          if (verdict?.status === "pass") {
            healingMeta.used = true;
            break;
          }
        }
      }
    }

    if (!draftResult.verdict) {
      draftResult.status = "fail";
    }

    return {
      ...draftResult,
      durationMs: Date.now() - start,
      healing: healingMeta,
    };
  } catch (err) {
    if (pendingBashEntries.length > 0) {
      appendStepToTranscript(transcript, { text: "", toolCalls: [] }, pendingBashEntries.splice(0));
    }
    persistTranscript(options, transcript);
    const error = String(err);
    return {
      scenario: options.scenario.frontmatter.name,
      filePath: options.scenario.filePath,
      status: "error",
      durationMs: Date.now() - start,
      verdict: null,
      transcript,
      artifactDir: options.artifactDir,
      error: options.redactor ? options.redactor.redact(error) : error,
    };
  }
}

export type { Verdict };

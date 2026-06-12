import {
  generateText,
  Output,
  stepCountIs,
  tool,
  type GenerateTextResult,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";

type TextGenerateOutput = ReturnType<typeof Output.text>;
import { z } from "zod";
import type { ArtifactsMode, PqaConfig } from "../types/config.js";
import type { ExtensionHooks, PreSystemPromptParams } from "../types/hooks.js";
import type { Scenario } from "../types/scenario.js";
import type { Skill } from "../types/skill.js";
import type {
  AgentTranscript,
  BashEntry,
  HealingMeta,
  ScenarioResult,
  Verdict,
} from "../types/verdict.js";
import { resolveAgentGuardConfig, resolveHealingConfig } from "../config/load.js";
import { HookRunner, HookAbortError } from "./hooks.js";
import {
  classifyFailure,
  isHealingEnabled,
  isRecoveryAllowed,
} from "../healing/classify.js";
import { buildRecoveryPrompt } from "../healing/recovery-prompt.js";
import { resolveStatePath } from "../auth/store.js";
import { assertNoDoomedRun } from "./browser-health.js";
import {
  assertNoRunGuard,
  RunGuardSyntheticFailError,
  type RunGuardMetadata,
} from "./run-guard.js";
import { buildBrowserEnv, prepareBrowserSession, runBash } from "./bash.js";
import { buildInitialPrompt, buildSystemPrompt } from "./prompt.js";
import {
  SkillLoadRegistry,
  formatAutoLoadedMessage,
  inferAutoSkillLoads,
  type SkillLoadKind,
} from "../skills/on-demand.js";
import { buildVerdictRetryPrompt } from "./verdict-retry-prompt.js";
import { persistTranscript } from "./transcript-persist.js";
import {
  addLanguageModelUsage,
  appendFinalTextToTranscript,
  appendStepToTranscript,
  appendTranscriptMessage,
  emptyTokenUsage,
  enrichVerdictWithStats,
  extractVerdict,
  formatStepForTranscript,
  stripLastAssistantTurn,
} from "./verdict.js";
import type { TokenUsageStats } from "../types/verdict.js";
import type { EnvRedactor } from "../redact/env-secrets.js";
import { createLlmModel } from "./llm-model.js";
import { buildProviderOptions } from "./provider-options.js";
import {
  isActionOverlayEnabled,
  resolveActionOverlayPreviewMs,
} from "../action-overlay/enabled.js";
import { maybePreviewAction } from "../action-overlay/preview.js";
import {
  createStepIntentCapture,
  wrapModelForStepIntent,
  type StepIntentCapture,
} from "../action-overlay/step-intent.js";

const MAX_VERDICT_RETRIES = 5;
/** Extra steps when re-emitting a verdict after an invalid completion. */
const VERDICT_RETRY_MAX_STEPS = 10;

function finalizeVerdict(
  verdict: ReturnType<typeof extractVerdict>,
  transcript: AgentTranscript,
  options: {
    durationMs: number;
    healing?: HealingMeta;
    redactor?: EnvRedactor;
    tokens?: TokenUsageStats;
  },
): Verdict | null {
  const redacted = options.redactor
    ? options.redactor.redactVerdict(verdict)
    : verdict;
  return enrichVerdictWithStats(redacted, transcript, {
    durationMs: options.durationMs,
    healing: options.healing,
    tokens: options.tokens,
  });
}

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
  runDir?: string;
  headed: boolean;
  verbose?: boolean;
  actionOverlay?: boolean;
  artifacts: ArtifactsMode;
  sessionName?: string;
  preparedStartUrl?: string;
  authStatePath?: string;
  authProfile?: string;
  profilePath?: string;
  provisioning?: boolean;
  onTurn?: () => Promise<void>;
  redactor?: EnvRedactor;
  noHealing?: boolean;
  scenarioCacheHints?: string;
  extensionHooks?: ExtensionHooks;
}

async function callLlm(options: {
  config: PqaConfig;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  providerOptions: ReturnType<typeof buildProviderOptions>;
  stopWhen: ReturnType<typeof stepCountIs>;
  onStepFinish: (step: {
    text: string;
    reasoningText?: string;
    toolCalls: Array<{ toolName: string; input: unknown }>;
  }) => Promise<void>;
  hookRunner?: HookRunner;
  turn: number;
  maxTurns: number;
  transcript?: AgentTranscript;
  withinTurnFingerprints?: string[];
  scenario?: Scenario;
  guardMetadata?: RunGuardMetadata;
  stepIntentCapture?: StepIntentCapture;
}): Promise<{
  result: GenerateTextResult<ToolSet, TextGenerateOutput>;
  text: string;
  totalUsage: LanguageModelUsage | undefined;
}> {
  if (options.transcript) {
    assertNoDoomedRun(
      options.transcript,
      options.config,
      options.withinTurnFingerprints ?? [],
    );
    if (options.scenario && options.guardMetadata) {
      assertNoRunGuard({
        transcript: options.transcript,
        config: options.config,
        metadata: options.guardMetadata,
        scenario: options.scenario,
      });
    }
  }

  let messages = options.messages;

  // Pre-LLM-turn hook
  if (options.hookRunner) {
    const preResult = await options.hookRunner.runPreLlmTurn({
      messages,
      turn: options.turn,
      maxTurns: options.maxTurns,
    });
    if (preResult.extraMessages?.length) {
      messages = [...messages, ...preResult.extraMessages];
    }
  }

  const model = options.stepIntentCapture
    ? wrapModelForStepIntent(createLlmModel(options.config), options.stepIntentCapture)
    : createLlmModel(options.config);

  const result = (await generateText({
    model,
    system: options.system,
    messages,
    tools: options.tools,
    providerOptions: options.providerOptions,
    stopWhen: options.stopWhen,
    onStepFinish: options.onStepFinish,
  })) as unknown as GenerateTextResult<ToolSet, TextGenerateOutput>;

  let text = result.text || "";

  // Post-LLM-turn hook
  if (options.hookRunner) {
    const postResult = await options.hookRunner.runPostLlmTurn({
      text,
      reasoningText: undefined,
      toolCalls: [],
      turn: options.turn,
      durationMs: 0,
    });
    if (postResult.text !== undefined) {
      text = postResult.text;
    }
  }

  return { result, text, totalUsage: result.totalUsage };
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
  tokenUsage: TokenUsageStats;
  hookRunner?: HookRunner;
  guardMetadata: RunGuardMetadata;
}): Promise<{
  result: GenerateTextResult<ToolSet, TextGenerateOutput>;
  finalText: string;
  tokenUsage: TokenUsageStats;
}> {
  let { result, finalText, tokenUsage } = options;

  for (
    let attempt = 0;
    !extractVerdict(finalText) && attempt < MAX_VERDICT_RETRIES;
    attempt++
  ) {
    // Pre-verdict hook
    if (options.hookRunner) {
      const preVerdictResult = await options.hookRunner.runPreVerdict({
        finalText,
        transcript: options.transcript,
      });
      finalText = preVerdictResult.finalText ?? finalText;
    }

    if (extractVerdict(finalText)) break;

    removeLastAssistantMessage(options.transcript);

    const retryPrompt = buildVerdictRetryPrompt(options.runOptions.scenario);
    appendTranscriptMessage(options.transcript, "user", retryPrompt);
    persistTranscript(options.runOptions, options.transcript);

    const retryMessages: ModelMessage[] = [
      ...stripLastAssistantTurn(result.response.messages as ModelMessage[]),
      { role: "user", content: retryPrompt },
    ];

    options.stepTiming.startMs = Date.now();
    const llmResult = await callLlm({
      config: options.config,
      system: options.system,
      messages: retryMessages,
      providerOptions: options.providerOptions,
      stopWhen: stepCountIs(VERDICT_RETRY_MAX_STEPS),
      onStepFinish: options.onStepFinish,
      hookRunner: options.hookRunner,
      turn: -1,
      maxTurns: -1,
      transcript: options.transcript,
      scenario: options.runOptions.scenario,
      guardMetadata: options.guardMetadata,
    });
    result = llmResult.result;
    finalText = llmResult.text || finalText;
    tokenUsage = addLanguageModelUsage(tokenUsage, llmResult.totalUsage);

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

  return { result, finalText, tokenUsage };
}

export async function runScenario(
  options: RunScenarioOptions,
): Promise<ScenarioResult> {
  const start = Date.now();
  const transcript: AgentTranscript = { entries: [] };
  const sessionName =
    options.sessionName ?? options.config.browser.sessionName;

  // Setup HookRunner (always created; hooks supplied via extensionHooks from caller)
  const hookCtx = {
    logger: {
      info: (msg: string) => {
        if (options.verbose) console.log(`[hook] ${msg}`);
      },
      warn: (msg: string) => console.warn(`[hook] ${msg}`),
      error: (msg: string) => console.error(`[hook] ${msg}`),
    },
    cwd: options.cwd,
    config: options.config,
    transcript,
    metadata: {
      ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
      ...(options.runDir ? { runDir: options.runDir } : {}),
      ...(options.provisioning ? { provisioning: true } : {}),
    } as Record<string, unknown>,
    abort: (reason: string): never => {
      throw new HookAbortError(reason);
    },
  };
  const hookRunner = new HookRunner(options.extensionHooks ?? {}, hookCtx);

  const overlayActive = isActionOverlayEnabled({
    actionOverlay: options.actionOverlay,
    config: options.config,
    headed: options.headed,
    engine: options.config.browser.engine,
  });
  const overlayPreviewMs = resolveActionOverlayPreviewMs(options.config);
  const stepIntentCapture = overlayActive ? createStepIntentCapture() : undefined;

  // Pre-scenario hook
  const preScenarioResult = await hookRunner.runPreScenario(options.scenario);
  if (preScenarioResult.action === "skip") {
    return {
      scenario: options.scenario.frontmatter.name,
      filePath: options.scenario.filePath,
      status: "skipped",
      durationMs: Date.now() - start,
      verdict: null,
      transcript,
      artifactDir: options.artifactDir,
      error: preScenarioResult.reason,
    };
  }
  if (preScenarioResult.action === "abort") {
    throw new HookAbortError(preScenarioResult.error);
  }

  let profilePath = options.profilePath;
  let authStatePath = options.authStatePath;
  if (
    preScenarioResult.action === "continue" &&
    preScenarioResult.browserContext
  ) {
    profilePath =
      preScenarioResult.browserContext.profilePath ?? profilePath;
    authStatePath =
      preScenarioResult.browserContext.authStatePath ?? authStatePath;
  }

  let preparedStartUrl = options.preparedStartUrl;
  const scenarioStartUrl = options.scenario.frontmatter.url;
  if (
    !preparedStartUrl &&
    (profilePath || authStatePath || scenarioStartUrl)
  ) {
    ({ startUrl: preparedStartUrl } = await prepareBrowserSession({
      cwd: options.cwd,
      timeoutMs: options.config.agent.bashTimeoutMs,
      sessionName,
      headed: options.headed,
      engine: options.config.browser.engine,
      lightpanda: options.config.browser.lightpanda,
      profilePath,
      authStatePath: profilePath ? undefined : authStatePath,
      startUrl: scenarioStartUrl,
      verbose: options.verbose,
      actionOverlay: overlayActive,
    }));
  }

  const authSavePath = options.authProfile
    ? resolveStatePath(options.cwd, options.authProfile, options.config)
    : undefined;

  const bashEnv = buildBrowserEnv({
    cwd: options.cwd,
    headed: options.headed,
    sessionName,
    engine: options.config.browser.engine,
    lightpanda: options.config.browser.lightpanda,
    profilePath,
    authStatePath: profilePath ? undefined : authStatePath,
    authSavePath,
    artifactDir: options.artifactDir,
  });

  Object.assign(hookCtx.metadata, {
    bashEnv,
    bashTimeoutMs: options.config.agent.bashTimeoutMs,
    preparedStartUrl,
    browserFailureFingerprints: [] as string[],
    guardNudgeSent: false,
    scenario: options.scenario,
  });

  let system = buildSystemPrompt(
    options.config,
    options.skills,
    options.scenario,
    {
      cwd: options.cwd,
      artifactDir: options.artifactDir,
      authStatePath: profilePath ? undefined : authStatePath,
      authProfile: options.authProfile,
      profilePath,
      headed: options.headed,
      sessionName,
      artifacts: options.artifacts,
      scenarioCacheHints: options.scenarioCacheHints,
      preparedStartUrl,
    },
  );

  // Pre-system-prompt hook
  if (hookRunner) {
    const preSystemResult = await hookRunner.runPreSystemPrompt({
      config: options.config,
      skills: options.skills,
      scenario: options.scenario,
      runtime: {
        cwd: options.cwd,
        artifactDir: options.artifactDir,
        headed: options.headed,
        sessionName,
        artifacts: options.artifacts,
        scenarioCacheHints: options.scenarioCacheHints,
        preparedStartUrl,
      },
    });
    if (preSystemResult.extraInstructions) {
      system += "\n" + preSystemResult.extraInstructions;
    }
  }

  let finalText = "";
  let turn = 0;
  let tokenUsage = emptyTokenUsage();
  const stepTiming = { startMs: Date.now() };
  const pendingBashEntries: BashEntry[] = [];
  const guardMetadata = hookCtx.metadata as RunGuardMetadata;

  const onDemandEnabled = options.config.skills.onDemand?.enabled !== false;
  const autoLoadEnabled =
    onDemandEnabled && options.config.skills.onDemand?.autoLoad !== false;
  const skillRegistry = new SkillLoadRegistry({
    maxChars: options.config.skills.onDemand?.maxChars,
    skillDirs: options.config.skills.dirs ?? [],
    preloadedNames: options.skills.map((s) => s.name),
  });

  const tools: ToolSet = {
    bash: tool({
      description:
        "Run ONE bash command. For UI interactions (click, fill, select, open, press), run a single agent-browser command per call. Use snapshot -i before acting on refs.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
      }),
      execute: async ({ command }) => {
        let resolvedCommand = command;
        let resolvedTimeout = options.config.agent.bashTimeoutMs;
        let resolvedEnv = { ...bashEnv } as Record<string, string>;
        for (const [k, v] of Object.entries(bashEnv)) {
          if (v !== undefined) resolvedEnv[k] = v;
        }

        // Pre-tool hook
        if (hookRunner) {
          const preToolResult = await hookRunner.runPreTool({
            command: resolvedCommand,
            timeoutMs: resolvedTimeout,
            env: resolvedEnv,
          });
          if (preToolResult.action === "abort") {
            throw new Error(preToolResult.abortError ?? "Hook aborted bash tool");
          }
          if (preToolResult.command !== undefined) {
            resolvedCommand = preToolResult.command;
          }
          if (preToolResult.timeoutMs !== undefined) {
            resolvedTimeout = preToolResult.timeoutMs;
          }
          if (preToolResult.extraEnv) {
            Object.assign(resolvedEnv, preToolResult.extraEnv);
          }
        }

        if (overlayActive) {
          const rawIntent = stepIntentCapture?.text ?? "";
          const intent =
            rawIntent && options.redactor
              ? options.redactor.redact(rawIntent)
              : rawIntent;
          await maybePreviewAction({
            command: resolvedCommand,
            cwd: options.cwd,
            env: resolvedEnv as NodeJS.ProcessEnv,
            timeoutMs: resolvedTimeout,
            previewMs: overlayPreviewMs,
            intent: intent || undefined,
            verbose: options.verbose,
          });
        }

        const entry = await runBash(resolvedCommand, {
          cwd: options.cwd,
          timeoutMs: resolvedTimeout,
          env: resolvedEnv as NodeJS.ProcessEnv,
        });

        // Post-tool hook
        if (hookRunner) {
          const postToolResult = await hookRunner.runPostTool(entry);
          if (postToolResult.action === "abort") {
            throw new Error(postToolResult.error);
          }
        }

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

  if (onDemandEnabled) {
    tools.load_skill = tool({
      description:
        "Load agent-browser references, templates, bundled skills, or custom project skills on demand. " +
        "Use instead of `agent-browser skills get` in bash. Load one item at a time, only when needed.",
      inputSchema: z.object({
        kind: z
          .enum(["reference", "template", "skill", "custom"])
          .describe(
            "reference = agent-browser doc, template = shell script, " +
              "skill = bundled agent-browser skill (falls back to custom), " +
              "custom = user SKILL.md from skills.dirs",
          ),
        name: z
          .string()
          .describe(
            "Item name: dogfood (bundled), prose-qa (custom), etc.",
          ),
      }),
      execute: async ({ kind, name }) => {
        try {
          const result = skillRegistry.load(
            options.cwd,
            kind as SkillLoadKind,
            name,
          );
          if (options.verbose && !result.alreadyLoaded) {
            console.log(`\n[load_skill] ${kind}:${name} (${result.content.length} chars)`);
          }
          return {
            kind: result.kind,
            name: result.name,
            alreadyLoaded: result.alreadyLoaded,
            truncated: result.truncated,
            content: result.content,
          };
        } catch (err) {
          return { error: String(err) };
        }
      },
    });
  }

  const initialPrompt = buildInitialPrompt(
    options.scenario,
    preparedStartUrl,
  );
  appendTranscriptMessage(transcript, "user", initialPrompt);

  const initialMessages: ModelMessage[] = [
    { role: "user", content: initialPrompt },
  ];

  if (autoLoadEnabled) {
    const autoSpecs = inferAutoSkillLoads({
      scenario: options.scenario,
    });
    const autoResults = autoSpecs.map((spec) =>
      skillRegistry.load(options.cwd, spec.kind, spec.name),
    );
    const autoMessage = formatAutoLoadedMessage(autoResults);
    if (autoMessage) {
      appendTranscriptMessage(transcript, "user", autoMessage);
      initialMessages.push({ role: "user", content: autoMessage });
    }
  }

  persistTranscript(options, transcript);

  const onStepFinish = async (step: {
    text: string;
    reasoningText?: string;
    toolCalls: Array<{ toolName: string; input: unknown }>;
  }) => {
    turn += 1;
    hookCtx.metadata.browserFailureFingerprints = [];
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
    const initialLlmResult = await callLlm({
      config: options.config,
      system,
      messages: initialMessages,
      tools,
      providerOptions,
      stopWhen: stepCountIs(options.config.agent.maxTurns),
      onStepFinish,
      hookRunner,
      turn: 0,
      maxTurns: options.config.agent.maxTurns,
      transcript,
      withinTurnFingerprints:
        (hookCtx.metadata.browserFailureFingerprints as string[]) ?? [],
      scenario: options.scenario,
      guardMetadata,
      stepIntentCapture,
    });
    let result = initialLlmResult.result;
    tokenUsage = addLanguageModelUsage(tokenUsage, initialLlmResult.totalUsage);

    finalText = initialLlmResult.text || finalText;
    appendFinalTextToTranscript(
      transcript,
      options.redactor ? options.redactor.redact(finalText) : finalText,
      { durationMs: Date.now() - stepTiming.startMs },
    );
    stepTiming.startMs = Date.now();
    persistTranscript(options, transcript);

    ({ result, finalText, tokenUsage } = await retryVerdictCompletion({
      config: options.config,
      system,
      providerOptions,
      result,
      transcript,
      runOptions: options,
      onStepFinish,
      finalText,
      stepTiming,
      tokenUsage,
      hookRunner,
      guardMetadata,
    }));

    // Pre-verdict hook
    if (hookRunner) {
      const preVerdictResult = await hookRunner.runPreVerdict({
        finalText,
        transcript,
      });
      finalText = preVerdictResult.finalText ?? finalText;
    }

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
      verdict: finalizeVerdict(verdict, transcript, {
        durationMs: Date.now() - start,
        healing: healingMeta,
        redactor: options.redactor,
        tokens: tokenUsage,
      }),
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
          const recoveryLlmResult = await callLlm({
            config: options.config,
            system,
            messages: recoveryMessages,
            tools,
            providerOptions,
            stopWhen: stepCountIs(
              resolveAgentGuardConfig(options.config).maxRecoverySteps,
            ),
            onStepFinish,
            hookRunner,
            turn,
            maxTurns: resolveAgentGuardConfig(options.config).maxRecoverySteps,
            transcript,
            withinTurnFingerprints:
              (hookCtx.metadata.browserFailureFingerprints as string[]) ?? [],
            scenario: options.scenario,
            guardMetadata,
            stepIntentCapture,
          });
          tokenUsage = addLanguageModelUsage(tokenUsage, recoveryLlmResult.totalUsage);

          finalText = recoveryLlmResult.text || finalText;
          appendFinalTextToTranscript(
            transcript,
            options.redactor ? options.redactor.redact(finalText) : finalText,
            { durationMs: Date.now() - stepTiming.startMs },
          );
          stepTiming.startMs = Date.now();
          persistTranscript(options, transcript);

          ({ result, finalText, tokenUsage } = await retryVerdictCompletion({
            config: options.config,
            system,
            providerOptions,
            result,
            transcript,
            runOptions: options,
            onStepFinish,
            finalText,
            stepTiming,
            tokenUsage,
            hookRunner,
            guardMetadata,
          }));
          verdict = extractVerdict(finalText);

          healingMeta.recoveryTurns += 1;

          draftResult = {
            ...draftResult,
            status: verdict?.status === "pass" ? "pass" : "fail",
            verdict: finalizeVerdict(verdict, transcript, {
              durationMs: Date.now() - start,
              healing: healingMeta,
              redactor: options.redactor,
              tokens: tokenUsage,
            }),
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

    // Post-scenario hook
    if (hookRunner) {
      const postScenarioResult = await hookRunner.runPostScenario(draftResult);
      if (postScenarioResult.result) {
        draftResult = { ...draftResult, ...postScenarioResult.result };
      }
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

    if (err instanceof RunGuardSyntheticFailError) {
      const guardHealing: HealingMeta = {
        used: false,
        recoveryTurns: 0,
        scenarioRetries: 0,
        failureKind: "unknown",
        signals: ["guard:max_failed_tool_calls"],
      };
      return {
        scenario: options.scenario.frontmatter.name,
        filePath: options.scenario.filePath,
        status: "fail",
        durationMs: Date.now() - start,
        verdict: finalizeVerdict(err.verdict, transcript, {
          durationMs: Date.now() - start,
          healing: guardHealing,
          redactor: options.redactor,
          tokens: tokenUsage,
        }),
        transcript,
        artifactDir: options.artifactDir,
        healing: guardHealing,
      };
    }

    const error = err instanceof HookAbortError ? err.reason : String(err);
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

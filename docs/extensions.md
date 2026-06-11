# Extensions / Hooks System

Prose QA provides an extension system via **hooks** — lifecycle callbacks that let you observe, modify, or abort the scenario execution at 8 distinct points.

## Configuration

Hooks are configured in `pqa.config.ts` under `extensions.hooks`:

```ts
import { defineConfig } from "prose-qa/define-config";

export default defineConfig({
  // ... standard config ...
  extensions: {
    hooks: {
      preScenario: [myPreScenarioHook],
      preSystemPrompt: [myPreSystemPromptHook],
      preLlmTurn: [myPreLlmTurnHook],
      postLlmTurn: [myPostLlmTurnHook],
      preTool: [myPreToolHook],
      postTool: [myPostToolHook],
      preVerdict: [myPreVerdictHook],
      postScenario: [myPostScenarioHook],
    },
  },
});
```

Each hook slot accepts an array of hook functions. Hooks are executed in order. You may mix inline functions and module paths:

```ts
extensions: {
  hooks: {
    preScenario: [
      logScenarioName,                          // inline function
      "./path/to/hooks/custom-pre-scenario.mjs", // resolved module
    ],
  },
}
```

Module files must export a default function. Supported extensions: `.ts`, `.js`, `.mjs`.

## Available Hook Points

### 1. `preScenario` — `PreScenarioHook`

**Signature:**
```ts
type PreScenarioHook = (
  scenario: Scenario,
  ctx: HookContext,
) => PreScenarioResult | Promise<PreScenarioResult>;
```

**Result:**
- `{ action: "continue" }` — proceed normally
- `{ action: "skip", reason: string }` — skip this scenario
- `{ action: "abort", error: string }` — abort the entire run

**Use cases:** Skip scenarios by name/tag, abort based on external conditions.

### 2. `preSystemPrompt` — `PreSystemPromptHook`

**Signature:**
```ts
type PreSystemPromptHook = (
  params: PreSystemPromptParams,
  ctx: HookContext,
) => PreSystemPromptResult | Promise<PreSystemPromptResult>;
```

**Result:** `{ extraInstructions?: string }` — appended to the system prompt after a newline.

**Use cases:** Inject custom instructions, add runtime context, load external directives.

### 3. `preLlmTurn` — `PreLlmTurnHook`

**Signature:**
```ts
type PreLlmTurnHook = (
  params: PreLlmTurnParams,
  ctx: HookContext,
) => PreLlmTurnResult | Promise<PreLlmTurnResult>;
```

**Result:** `{ extraMessages?: ModelMessage[] }` — additional messages injected before the LLM call.

**Use cases:** Inject few-shot examples, add system reminders mid-run.

### 4. `postLlmTurn` — `PostLlmTurnHook`

**Signature:**
```ts
type PostLlmTurnHook = (
  params: PostLlmTurnParams,
  ctx: HookContext,
) => PostLlmTurnResult | Promise<PostLlmTurnResult>;
```

**Result:** `{ text?: string }` — overrides the LLM response text (last hook wins).

**Use cases:** Post-process LLM output, filter sensitive content, reformat responses.

### 5. `preTool` — `PreToolHook`

**Signature:**
```ts
type PreToolHook = (
  params: PreToolParams,
  ctx: HookContext,
) => PreToolResult | Promise<PreToolResult>;
```

**Result:**
- `command?: string` — rewrite the bash command
- `timeoutMs?: number` — reduce the timeout (min across all hooks)
- `extraEnv?: Record<string, string>` — additional environment variables
- `action?: "continue" | "abort"` — abort the tool execution
- `abortError?: string` — error message when aborting

**Use cases:** Rewrite commands, inject env secrets, block dangerous commands.

### 6. `postTool` — `PostToolHook`

**Signature:**
```ts
type PostToolHook = (
  entry: BashEntry,
  ctx: HookContext,
) => PostToolResult | Promise<PostToolResult>;
```

**Result:**
- `{ action: "continue" }` — proceed normally
- `{ action: "abort", error: string }` — abort the run

**Use cases:** Abort on command failure (non-zero exit), enforce strict policies.

### 7. `preVerdict` — `PreVerdictHook`

**Signature:**
```ts
type PreVerdictHook = (
  params: PreVerdictParams,
  ctx: HookContext,
) => PreVerdictResult | Promise<PreVerdictResult>;
```

**Result:** `{ finalText?: string }` — overrides the final text before verdict parsing (last hook wins).

**Use cases:** Patch malformed JSON, extract verdict from wrapped output.

### 8. `postScenario` — `PostScenarioHook`

**Signature:**
```ts
type PostScenarioHook = (
  result: ScenarioResult,
  ctx: HookContext,
) => PostScenarioResult | Promise<PostScenarioResult>;
```

**Result:** `{ result?: Partial<ScenarioResult> }` — fields are spread over the final result.

**Use cases:** Custom logging, result enrichment, external notifications.

## HookContext

Every hook receives a `HookContext` with:

| Field       | Description |
|-------------|-------------|
| `logger`    | `{ info, warn, error }` — structured logger (prefixes `[hook]`) |
| `cwd`       | Current working directory |
| `config`    | The resolved `PqaConfig` |
| `transcript`| The `AgentTranscript` (live, mutable) |
| `metadata`  | `Record<string, unknown>` — shared mutable object for inter-hook communication |
| `abort`     | `(reason: string) => never` — throws a `HookAbortError` |

## Inter-hook Communication

Hooks can share data via `ctx.metadata`:

```ts
// First hook sets data
const setter: PreScenarioHook = async (scenario, ctx) => {
  ctx.metadata["startedAt"] = Date.now();
  return { action: "continue" };
};

// Later hook reads it
const getter: PostScenarioHook = async (result, ctx) => {
  const startedAt = ctx.metadata["startedAt"] as number;
  ctx.logger.info(`Duration: ${Date.now() - startedAt}ms`);
  return {};
};
```

## Fail-Safe Behavior

- If a hook function throws an exception, the error is logged via `ctx.logger.error` and the hook is **skipped** — execution continues with the next hook in the chain.
- If hook module resolution fails (invalid path, missing export), a warning is printed and the hook is skipped.
- This ensures that a broken hook never blocks scenario execution.

## Worker Parallelism Limitation

When using `--parallel` (subprocess workers), the config is re-loaded in each worker via `loadConfig()`. This means:

- **Module path hooks** (`"./path/to/hook.mjs"`) work correctly — they are re-resolved in each worker.
- **Inline function hooks** (closures capturing parent variables) may not work as expected — the function reference is serialized/unserialized differently across the process boundary.

For parallel execution, prefer module path hooks over inline closures.

## Example

See `docs/examples/extensions/basic-hooks.ts` for a complete, runnable example.

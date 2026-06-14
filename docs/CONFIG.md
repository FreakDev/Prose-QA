# Configuration reference

Prose-QA loads configuration from bundled defaults ([`pqa.config.ts`](../pqa.config.ts) in the npm package), then merges your local overrides. Only keys you set need to appear in your project file.

**Local config files** (first match in the project root wins): `pqa.config.json`, `pqa.config.mjs`, `pqa.config.js`, `pqa.config.ts`.

**CLI helper** — create or update `pqa.config.json` without editing by hand (dot notation for nested keys):

```bash
pqa config llm.provider anthropic
pqa config browser.headed true
pqa config envVars '["PQA_TEST_EMAIL","PQA_TEST_PASSWORD"]'
```

Unknown keys are rejected; only properties that exist in the bundled reference config are allowed.

The bundled `pqa.config.ts` imports `./dist/hooks/defaults.js` — run `npm run build` before relying on bundled defaults in this repo (see [ADR-0001](adr/0001-auth-via-pre-batch-hooks.md)).

## Minimal example

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
```

## Environment variables

| Variable           | Description                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `PQA_LLM_API_KEY`  | API key for the configured cloud provider (`anthropic`, `openai`, `fireworks`, `google`, `openrouter`) |
| `PQA_LLM_PROVIDER` | Sets `llm.provider` when omitted from `pqa.config` (dev / CI shortcut)                                 |
| `PQA_LLM_MODEL`    | Sets `llm.model` when omitted from `pqa.config`                                                        |

Ollama does not require `PQA_LLM_API_KEY`. Any name listed in `envVars` must be set before a run starts.

## All options

### `scenariosDir` (string)

Root directory for scenario markdown files. Set directly in `pqa.config.json`.

|             |              |
| ----------- | ------------ |
| **Default** | `scenarios` |

### `envVars` (string[])

Environment variable **names** the agent should know about. Injected into the system prompt at runtime (set / not-set status only — never values). Validated before each run.

|             |      |
| ----------- | ---- |
| **Default** | `[]` |

### `sensitiveEnvVars` (string[])

Env var names whose **values** are redacted from transcripts, verdicts, reports, and verbose logs (replaced with `${VAR_NAME}`). If omitted, defaults to `envVars`. `PQA_LLM_API_KEY` is always redacted for cloud providers.

|             |                   |
| ----------- | ----------------- |
| **Default** | same as `envVars` |

---

### `llm` (object)

LLM provider and model used for test runs, recording generation, and analysis.

| Key        | Type                                                                                       | Default | Description                                                                          |
| ---------- | ------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------ |
| `provider` | `"anthropic"` \| `"openai"` \| `"fireworks"` \| `"ollama"` \| `"google"` \| `"openrouter"` | —       | LLM backend (required in config or via `PQA_LLM_PROVIDER`)                           |
| `model`    | string                                                                                     | —       | Model identifier for the chosen provider (required in config or via `PQA_LLM_MODEL`) |

#### `llm.thinking` (object, optional)

Extended thinking / reasoning. Provider support varies.

| Key               | Type                                                                      | Default | Description                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`         | boolean                                                                   | `true`  | Enable extended thinking                                                                                                                                          |
| `budgetTokens`    | number                                                                    | `10000` | Thinking token budget (Anthropic, Fireworks, Google, OpenRouter)                                                                                                  |
| `reasoningEffort` | `"none"` \| `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | —       | OpenAI reasoning effort; mapped to Anthropic effort, Google thinking level, and OpenRouter reasoning effort. Ollama uses `think` mode only (other fields ignored) |

---

### `browser` (object)

Default browser behavior for scenario runs (overridable per run with `--headed` / `--no-headed`).

| Key              | Type                              | Default   | Description                          |
| ---------------- | --------------------------------- | --------- | ------------------------------------ |
| `headed`         | boolean                           | `false`   | Run browser in visible (headed) mode |
| `sessionName`    | string                            | `"pqa"`   | agent-browser session name           |
| `defaultTimeout` | number                            | `25000`   | Default timeout in milliseconds      |
| `engine`         | `"chrome"` \| `"lightpanda"`    | `"chrome"` | agent-browser engine (`AGENT_BROWSER_ENGINE`) |

#### `browser.lightpanda` (object, optional)

Used when `browser.engine` is `lightpanda`.

| Key              | Type    | Default           | Description                                                                 |
| ---------------- | ------- | ----------------- | --------------------------------------------------------------------------- |
| `executablePath` | string  | `"./.pqa/engine"` | Path to Lightpanda binary or directory (`AGENT_BROWSER_EXECUTABLE_PATH`)  |
| `telemetry`      | boolean | `false`           | When `false`, sets `LIGHTPANDA_DISABLE_TELEMETRY=true`                      |

Install the binary with `pqa install-browser lightpanda`.

---

### `skills` (object)

Agent skill discovery and preloading ([agentskills.io](https://agentskills.io/) `SKILL.md` format). The vendored **core** skill (`skills/agent-browser/`) is always loaded into the system prompt — it does not need to appear in `preloads`.

| Key        | Type     | Default           | Description                                                                                              |
| ---------- | -------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `dirs`     | string[] | `[".pqa/skills"]` | Directories scanned for custom `SKILL.md` files. Relative paths resolve like bundled assets. Can be `[]` |
| `preloads` | string[] | `[]`              | Extra skill names always appended to the system prompt (the vendored `core` skill is always loaded)      |

#### `skills.onDemand` (object, optional)

Lazy loading for the vendored agent-browser skill. The full skill package (references, templates, bundled skills) is synced at install via `scripts/sync-skills.mjs`, but only the **minimal** `core` body is injected into the system prompt.

| Key        | Type    | Default | Description                                                                              |
| ---------- | ------- | ------- | ---------------------------------------------------------------------------------------- |
| `enabled`  | boolean | `true`  | Expose the `load_skill` tool and on-demand catalog in the system prompt                  |
| `autoLoad` | boolean | `true`  | Harness auto-injects context-aware references before the run when enabled |
| `maxChars` | number  | `50000` | Max characters returned per `load_skill` call                                            |

Custom skills discovered under `skills.dirs` (but not listed in `skills.preloads` or scenario frontmatter) appear in the on-demand catalog and load via `load_skill` with `kind=custom` (or `kind=skill` as fallback).

Disable with `skills.onDemand.enabled: false` to fall back to the minimal core only (no `load_skill` tool).

---

### `auth` (object, optional)

Maps profile keys to auth scenarios and optional state file paths. Used when consumer scenarios declare `auth: <key>` in frontmatter.

| Key per profile | Type   | Description                                                        |
| --------------- | ------ | ------------------------------------------------------------------ |
| `scenario`      | string | `frontmatter.name` of the login/auth scenario (provisioning)       |
| `statePath`     | string | Optional override for state JSON (default: `.pqa/auth/<key>.json`) |

Example:

```json
{
  "auth": {
    "admin": {
      "scenario": "login-admin"
    }
  }
}
```

Persistence depends on `browser.engine`:

- **chrome** — Chrome profile directory (`.pqa/profiles/<key>/`)
- **lightpanda** — agent-browser state JSON (`.pqa/auth/<key>.json`)

CLI: `pqa auth list`, `pqa auth clear [profile]`, `--auth-refresh` on `pqa run`. Provisioning runs via `preBatch` hooks — see [extensions.md](extensions.md) and [ADR-0001](adr/0001-auth-via-pre-batch-hooks.md). There is no `pqa auth save`.

---

### `agent` (object)

Agent loop limits.

| Key                           | Type   | Default  | Description                                                   |
| ----------------------------- | ------ | -------- | ------------------------------------------------------------- |
| `maxTurns`                    | number | `80`     | Maximum agent turns per scenario                              |
| `bashTimeoutMs`               | number | `10000`  | Timeout for each bash (agent-browser) command in milliseconds |
| `parallel`                    | number | `0`      | Max concurrent workers when `--parallel` is used (`0` = sequential; `-1` = unlimited) |
| `workerInactivityTimeoutMs`   | number | `120000` | Worker subprocess watchdog timeout (ms)                       |
| `workerHeartbeatIntervalMs`   | number | `15000`  | Worker heartbeat write interval (ms)                          |
| `guard`                       | object | see below | Generic effort limits (failed bash budget, recovery step cap) |

If the bundled config file is missing (broken install), [`MINIMAL_FALLBACK_CONFIG`](../src/config/load.ts) uses `maxTurns: 200` and `bashTimeoutMs: 120000`.

#### `agent.guard` (object, optional)

Limits agent effort when bash commands fail repeatedly. Enforced by the default `preLlmTurn` and `postTool` hooks. See [ADR-0002](adr/0002-agent-run-guard.md).

| Key                    | Type   | Default | Description                                                                 |
| ---------------------- | ------ | ------- | --------------------------------------------------------------------------- |
| `nudgeFailedToolCalls` | number | `10`    | Inject a harness nudge once this many failed `agent-browser` calls occur. `0` disables |
| `maxFailedToolCalls`   | number | `20`    | Abort with a synthetic `fail` verdict at this count. `0` disables           |
| `maxRecoverySteps`     | number | `10`    | Max LLM steps per recovery loop (separate from `maxTurns`)                  |

---

### `browserHealth` (object, optional)

Fail-fast checks for unrecoverable browser errors (via the default `postTool` hook).

| Key                       | Type   | Default | Description                                                          |
| ------------------------- | ------ | ------- | -------------------------------------------------------------------- |
| `circuitBreakerThreshold` | number | `3`     | Abort after N identical consecutive `agent-browser` command failures |

---

### `healing` (object, optional)

Conservative self-healing: in-run recovery and transient-only scenario retries. See [HOWTO §10 — Healing / retries](HOWTO.md#10-healing--retries).

| Key                 | Type     | Default   | Description                                                                                  |
| ------------------- | -------- | --------- | -------------------------------------------------------------------------------------------- |
| `enabled`           | boolean  | `true`    | Master switch for in-run recovery and transient retry gating                                 |
| `maxRecoveryTurns`  | number   | `2`       | Extra agent turns after a failed verdict (same browser session)                              |
| `recoverOnUnknown`  | boolean  | `false`   | Allow recovery when failure class is unknown but bash output looks transient                 |
| `transientPatterns` | string[] | see below | Substrings matched against agent-browser bash stderr/stdout to classify transient failures |

Default `transientPatterns`: `timeout`, `timed out`, `waiting for`, `navigation`, `net::`, `detached`, `stale`, `interrupted`, `networkidle`.

Failures classified as `infrastructure` (DNS, SSL, browser crash, repeated identical errors, etc.) are never retried when `--retries-policy transient`.

CLI equivalents: `--no-healing`, `--retries N`, `--retries-policy transient|always`, `--no-cache`.

---

### `cache` (object, optional)

Scenario replay cache settings. See [HOWTO §9 — Replay cache](HOWTO.md#9-replay-cache).

| Key       | Type    | Default        | Description                              |
| --------- | ------- | -------------- | ---------------------------------------- |
| `dir`     | string  | `".pqa/cache"` | Directory for per-scenario replay hints  |
| `enabled` | boolean | `true`         | Master switch (opt-out via `--no-cache`) |

---

### `recorder` (object, optional)

Settings for `pqa record`. See [HOWTO §8 — Record → markdown](HOWTO.md#8-record--markdown).

| Key           | Type     | Default             | Description                                    |
| ------------- | -------- | ------------------- | ---------------------------------------------- |
| `bridgePort`  | number   | `17321`             | Local HTTP port for the recording event bridge |
| `outputDir`   | string   | `".pqa/recordings"` | Directory for saved recording sessions         |
| `defaultTags` | string[] | `["recorded"]`      | Tags added to generated scenario frontmatter   |

---

### `report` (object, optional)

Default report output location. Overridable per run with `--report-output` and `--report-zip`.

| Key          | Type    | Default | Description                                                                 |
| ------------ | ------- | ------- | --------------------------------------------------------------------------- |
| `outputPath` | string  | `""`    | Directory or file path; trailing `/` creates a `runId` folder or zip inside |
| `zip`        | boolean | `false` | Emit report as zip instead of a directory                                   |

When `outputPath` is empty, reports go to `.pqa/runs/<runId>/`.

---

### `extensions` (object, optional)

Extension hooks and action overlay defaults. See [extensions.md](extensions.md).

#### `extensions.hooks` (object, optional)

Lifecycle hook arrays keyed by slot (`preBatch`, `postBatch`, `preScenario`, `preSystemPrompt`, `preLlmTurn`, `postLlmTurn`, `preTool`, `postTool`, `preVerdict`, `postScenario`). Each slot accepts inline functions or module paths (`.ts`, `.js`, `.mjs`).

Bundled default: `defaultExtensionHooks` from `prose-qa/hooks` (auth provisioning, browser health, run guard). **Override is strict** — replacing `extensions.hooks` without spreading defaults removes built-in auth provisioning.

```ts
import { defineConfig } from "prose-qa/define-config";
import { defaultExtensionHooks, mergeExtensionHooks } from "prose-qa/hooks";

export default defineConfig({
  extensions: {
    hooks: mergeExtensionHooks(defaultExtensionHooks, {
      postBatch: [notifySlack],
    }),
  },
});
```

#### `extensions.actionOverlay` (object, optional)

In-page visual overlay before agent-browser actions (Chrome headed only). Debug mode enables overlay by default unless `--no-action-overlay`.

| Key         | Type    | Default | Description                                      |
| ----------- | ------- | ------- | ------------------------------------------------ |
| `enabled`   | boolean | `false` | Master switch when not overridden by CLI         |
| `previewMs` | number  | `800`   | Blocking preview duration before each action (ms) |

---

## Full reference example

```json
{
  "scenariosDir": "scenarios",
  "envVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "sensitiveEnvVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "thinking": {
      "enabled": true,
      "budgetTokens": 10000,
      "reasoningEffort": "high"
    }
  },
  "browser": {
    "headed": false,
    "sessionName": "pqa",
    "defaultTimeout": 25000,
    "engine": "chrome",
    "lightpanda": {
      "executablePath": "./.pqa/engine",
      "telemetry": false
    }
  },
  "skills": {
    "dirs": [".pqa/skills"],
    "preloads": []
  },
  "auth": {
    "admin": {
      "scenario": "login-admin"
    }
  },
  "agent": {
    "maxTurns": 80,
    "bashTimeoutMs": 10000,
    "parallel": 0,
    "guard": {
      "nudgeFailedToolCalls": 10,
      "maxFailedToolCalls": 20,
      "maxRecoverySteps": 10
    }
  },
  "browserHealth": {
    "circuitBreakerThreshold": 3
  },
  "healing": {
    "enabled": true,
    "maxRecoveryTurns": 2,
    "recoverOnUnknown": false,
    "transientPatterns": [
      "timeout",
      "timed out",
      "waiting for",
      "navigation",
      "net::",
      "detached",
      "stale",
      "interrupted",
      "networkidle"
    ]
  },
  "recorder": {
    "bridgePort": 17321,
    "outputDir": ".pqa/recordings",
    "defaultTags": ["recorded"]
  },
  "cache": {
    "dir": ".pqa/cache",
    "enabled": true
  },
  "report": {
    "outputPath": "",
    "zip": false
  },
  "extensions": {
    "actionOverlay": {
      "enabled": false,
      "previewMs": 800
    }
  }
}
```

For `extensions.hooks`, import `defaultExtensionHooks` in TypeScript config — see [extensions.md](extensions.md).

## See also

- [README.md](../README.md) — quick start and CLI
- [HOWTO.md](HOWTO.md) — progressive tutorials
- [extensions.md](extensions.md) — hooks system
- [SECURITY.md](../SECURITY.md) — secrets and artifacts

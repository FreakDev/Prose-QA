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

## Minimal example

```json
{
  "envVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "sensitiveEnvVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "auth": {
    "admin": {
      "scenario": "login-admin",
      "statePath": ".pqa/auth/admin.json"
    }
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
| **Default** | `scenarios/` |

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

| Key              | Type    | Default | Description                          |
| ---------------- | ------- | ------- | ------------------------------------ |
| `headed`         | boolean | `false` | Run browser in visible (headed) mode |
| `sessionName`    | string  | `"pqa"` | agent-browser session name           |
| `defaultTimeout` | number  | `25000` | Default timeout in milliseconds      |

---

### `skills` (object)

Agent skill discovery and preloading ([agentskills.io](https://agentskills.io/) `SKILL.md` format).

| Key        | Type     | Default                        | Description                                                                              |
| ---------- | -------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `dirs`     | string[] | `["skills", ".agents/skills"]` | Directories scanned for skills. Relative paths resolve like bundled assets               |
| `preloads` | string[] | `["core"]`                     | Skill names always appended to the system prompt (`core` = vendored agent-browser skill) |

---

### `agent` (object)

Agent loop limits.

| Key             | Type   | Default  | Description                                                   |
| --------------- | ------ | -------- | ------------------------------------------------------------- |
| `maxTurns`      | number | `200`    | Maximum agent turns per scenario                              |
| `bashTimeoutMs` | number | `120000` | Timeout for each bash (agent-browser) command in milliseconds |

---

### `auth` (object)

Map of auth profile names to login scenario configuration. Consumer scenarios reference a profile via frontmatter `auth: <name>`.

Each profile key (e.g. `admin`) supports:

| Key         | Type   | Default                    | Description                                                              |
| ----------- | ------ | -------------------------- | ------------------------------------------------------------------------ |
| `scenario`  | string | —                          | `frontmatter.name` of the on-demand auth scenario (e.g. `"login-admin"`) |
| `statePath` | string | `.pqa/auth/<profile>.json` | agent-browser state file path                                            |

When a scenario uses `auth: admin`, the harness loads cached state from `statePath` or runs the auth scenario once, saves browser state, then continues. See [HOWTO §7 — Hybrid auth](HOWTO.md#7-hybrid-auth).

---

### `healing` (object, optional)

Conservative self-healing: in-run recovery and transient-only scenario retries. See [HOWTO §11 — Healing / retries](HOWTO.md#11-healing--retries).

| Key                 | Type     | Default   | Description                                                                                  |
| ------------------- | -------- | --------- | -------------------------------------------------------------------------------------------- |
| `enabled`           | boolean  | `true`    | Master switch for in-run recovery and transient retry gating                                 |
| `maxRecoveryTurns`  | number   | `2`       | Extra agent turns after a failed verdict (same browser session)                              |
| `recoverOnUnknown`  | boolean  | `false`   | Allow recovery when failure class is unknown but bash output looks transient                 |
| `transientPatterns` | string[] | see below | Substrings matched against bash output and checkpoint reasons to classify transient failures |

Default `transientPatterns`: `timeout`, `timed out`, `not found`, `waiting for`, `navigation`, `net::`, `target closed`, `detached`, `stale`, `interrupted`.

CLI equivalents: `--no-healing`, `--retries N`, `--retries-policy transient|always`, `--no-cache`.

---

### `cache` (object, optional)

Scenario replay cache settings. See [HOWTO §10 — Replay cache](HOWTO.md#10-replay-cache).

| Key       | Type    | Default        | Description                              |
| --------- | ------- | -------------- | ---------------------------------------- |
| `dir`     | string  | `".pqa/cache"` | Directory for per-scenario replay hints  |
| `enabled` | boolean | `true`         | Master switch (opt-out via `--no-cache`) |

---

### `recorder` (object, optional)

Settings for `pqa record`. See [HOWTO §9 — Record → markdown](HOWTO.md#9-record--markdown).

| Key           | Type     | Default             | Description                                    |
| ------------- | -------- | ------------------- | ---------------------------------------------- |
| `bridgePort`  | number   | `17321`             | Local HTTP port for the recording event bridge |
| `outputDir`   | string   | `".pqa/recordings"` | Directory for saved recording sessions         |
| `defaultTags` | string[] | `["recorded"]`      | Tags added to generated scenario frontmatter   |

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
    "defaultTimeout": 25000
  },
  "skills": {
    "dirs": ["skills", ".agents/skills"],
    "preloads": ["core"]
  },
  "agent": {
    "maxTurns": 200,
    "bashTimeoutMs": 120000
  },
  "auth": {
    "admin": {
      "scenario": "login-admin",
      "statePath": ".pqa/auth/admin.json"
    }
  },
  "healing": {
    "enabled": true,
    "maxRecoveryTurns": 2,
    "recoverOnUnknown": false,
    "transientPatterns": [
      "timeout",
      "timed out",
      "not found",
      "waiting for",
      "navigation",
      "net::",
      "target closed",
      "detached",
      "stale",
      "interrupted"
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
  }
}
```

## See also

- [README.md](../README.md) — quick start and CLI
- [HOWTO.md](HOWTO.md) — progressive tutorials
- [SECURITY.md](../SECURITY.md) — secrets and artifacts

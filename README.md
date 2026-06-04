# Prose-QA

Agent harness for **end-to-end regression testing** of web apps. Scenarios are written in natural language with explicit verification checkpoints. An LLM agent executes them using [Vercel `agent-browser`](https://github.com/vercel-labs/agent-browser) via bash — no browser wrapper in TypeScript.

## How-to (step by step)

See **[docs/HOWTO.md](docs/HOWTO.md)** for a progressive guide (scenario format → agent-browser → debug/run → CI → auth → MCP → record → cache → healing → analyze).

## Features

- **Natural language scenarios** with `# Goal`, `# Steps`, and `# Then` checkpoints
- **Agent Skills** ([agentskills.io](https://agentskills.io/)) — Anthropic-compatible `SKILL.md` format
- **Pinned agent-browser skill** vendored at `skills/agent-browser/` (installed via `postinstall` on `npm ci` / `npm install`)
- **CI + local debug** modes with HTML/JSON reports

## Install

```bash
npm install -g prose-qa
# or in a project:
npm install prose-qa
npx pqa --help
```

Requires Node.js 20+ and an LLM API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIREWORKS_API_KEY`, `OPENROUTER_API_KEY`, etc. depending on config).

On first install, `agent-browser` downloads its browser binary via `postinstall`. In CI, run:

```bash
npx agent-browser install --with-deps
```

## New project setup

1. Install the package in your app repo (or globally).
2. Create `pqa.config.json` in your project root (or use `pqa config <key> <value>` to set values incrementally):

```bash
pqa config llm.provider anthropic
pqa config llm.model claude-sonnet-4-20250514
```

Supported config filenames (first match wins): `pqa.config.json`, `pqa.config.mjs`, `pqa.config.js`, `pqa.config.ts`.

3. Create scenarios under `scenarios/` (see [0_hello-world.md](scenarios/0_hello-world.md)).
4. Copy [`.env.example`](.env.example) to `.env.development.local` (or set env vars in CI) and fill in secrets.
5. Run:

```bash
export ANTHROPIC_API_KEY=...
pqa run scenarios/**/*.md --tags smoke
```

Bundled harness assets (`prompt/`, `skills/`) ship inside the npm package. Your project only needs `pqa.config.*`, `scenarios/`, and optional `.agents/skills/` overrides.

## Development (this repo)

```bash
git clone https://github.com/FreakDev/Prose-QA.git
cd Prose-QA
npm ci
npm run build

export ANTHROPIC_API_KEY=...

# CI mode
npm run dev -- run scenarios/**/*.md --tags example

# Debug single scenario
npm run dev -- debug scenarios/0_hello-world.md --verbose

# Auth demo (smoke server with hardcoded demo credentials)
npm run smoke:server
export PQA_TEST_EMAIL=demo@pqa.local PQA_TEST_PASSWORD=demo-password
npm run dev -- debug scenarios/1_example-authenticated.md --verbose
```

The smoke server (`scripts/smoke-hello-server.mjs`) serves `/` (Hello World), `/login`, and protected `/projects`. Credentials match `.env.example`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request guidelines.

## MCP server (Cursor, Claude Desktop, …)

Start the Prose-QA MCP server over stdio so clients can read the **create-pqa-scenario** skill and run scenarios from inline markdown (same format as `scenarios/*.md`):

```bash
pqa mcp
# or from this repo:
npm run mcp
```

**Cursor** (`.cursor/mcp.json` in your app repo — `cwd` must be the project with `pqa.config` and env vars):

```json
{
  "mcpServers": {
    "prose-qa": {
      "command": "npx",
      "args": ["-y", "prose-qa", "mcp"]
    }
  }
}
```

After `npm run build` in this repo, use `"command": "node"` and `"args": ["dist/cli/index.js", "mcp"]` with `cwd` set to the Prose-QA repo root.

| Surface | Purpose |
| -------- | -------- |
| Resource `pqa://skill/create-pqa-scenario` | Full create-pqa-scenario `SKILL.md` |
| Tool `get_create_pqa_scenario_skill` | Same skill as text |
| Tool `validate_scenario` | Parse `content` without running the browser |
| Tool `run_scenario` | Execute `content` (requires LLM + browser env) |
| Prompt `author_pqa_scenario` | Template that includes the skill |

## Scenario format

See [prompt/references/scenario-format.md](prompt/references/scenario-format.md).

```markdown
---
name: checkout-happy-path
tags: [smoke]
auth: admin
url: https://app.example.com
---

# Goal
As a user, complete checkout.

# Steps
1. Add item to cart and proceed to checkout.
2. Complete payment with test card.

# Then
- url contains "/order-confirmation"
- page shows "Thank you"
```

## Configuration

Prose-QA loads configuration from the bundled defaults ([`pqa.config.ts`](pqa.config.ts) in the npm package), then merges your local overrides. Only keys you set need to appear in your project file.

**Local config files** (first match in the project root wins): `pqa.config.json`, `pqa.config.mjs`, `pqa.config.js`, `pqa.config.ts`.

**CLI helper** — create or update `pqa.config.json` without editing by hand (dot notation for nested keys):

```bash
pqa config llm.provider anthropic
pqa config browser.headed true
pqa config envVars '["PQA_TEST_EMAIL","PQA_TEST_PASSWORD"]'
```

Unknown keys are rejected; only properties that exist in the bundled reference config are allowed.

### Minimal example

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

### Environment variables

| Variable | Description |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required when `llm.provider` is `anthropic` |
| `OPENAI_API_KEY` | Required when `llm.provider` is `openai` |
| `FIREWORKS_API_KEY` | Required when `llm.provider` is `fireworks` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required when `llm.provider` is `google` |
| `OPENROUTER_API_KEY` | Required when `llm.provider` is `openrouter` |
| `PQA_LLM_PROVIDER` | Overrides bundled default `llm.provider` (dev / CI shortcut) |
| `PQA_LLM_MODEL` | Overrides bundled default `llm.model` |

Ollama does not require an API key env var. Any name listed in `envVars` must be set before a run starts.

### All options

#### `scenariosDir` (string)

Root directory for scenario markdown files. Set directly in `pqa.config.json`.

| | |
| --- | --- |
| **Default** | `scenarios`, or `pqa/` when that directory exists and `scenarios/` does not |

#### `systemPromptPath` (string)

Path to the agent system prompt markdown file. Relative paths resolve against the project cwd first, then bundled package assets.

| | |
| --- | --- |
| **Default** | `prompt/SYSTEM.md` (bundled) |

#### `envVars` (string[])

Environment variable **names** the agent should know about. Injected into the system prompt at runtime (set / not-set status only — never values). Validated before each run.

| | |
| --- | --- |
| **Default** | `[]` |

#### `sensitiveEnvVars` (string[])

Env var names whose **values** are redacted from transcripts, verdicts, reports, and verbose logs (replaced with `${VAR_NAME}`). If omitted, defaults to `envVars`. The LLM API key for the configured provider is always redacted.

| | |
| --- | --- |
| **Default** | same as `envVars` |

---

#### `llm` (object)

LLM provider and model used for test runs, recording generation, and analysis.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | `"anthropic"` \| `"openai"` \| `"fireworks"` \| `"ollama"` \| `"google"` \| `"openrouter"` | `"anthropic"` | LLM backend |
| `model` | string | `"claude-sonnet-4-20250514"` | Model identifier for the chosen provider |

##### `llm.thinking` (object, optional)

Extended thinking / reasoning. Provider support varies.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable extended thinking |
| `budgetTokens` | number | `10000` | Thinking token budget (Anthropic, Fireworks, Google, OpenRouter) |
| `reasoningEffort` | `"none"` \| `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | — | OpenAI reasoning effort; mapped to Anthropic effort, Google thinking level, and OpenRouter reasoning effort. Ollama uses `think` mode only (other fields ignored) |

---

#### `browser` (object)

Default browser behavior for scenario runs (overridable per run with `--headed` / `--no-headed`).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `headed` | boolean | `false` | Run browser in visible (headed) mode |
| `sessionName` | string | `"pqa"` | agent-browser session name |
| `defaultTimeout` | number | `25000` | Default timeout in milliseconds |

---

#### `skills` (object)

Agent skill discovery and preloading ([agentskills.io](https://agentskills.io/) `SKILL.md` format).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `dirs` | string[] | `["skills", ".agents/skills"]` | Directories scanned for skills. Relative paths resolve like bundled assets |
| `preloads` | string[] | `["core"]` | Skill names always appended to the system prompt (`core` = vendored agent-browser skill) |

---

#### `agent` (object)

Agent loop limits.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `maxTurns` | number | `200` | Maximum agent turns per scenario |
| `bashTimeoutMs` | number | `120000` | Timeout for each bash (agent-browser) command in milliseconds |

---

#### `auth` (object)

Map of auth profile names to login scenario configuration. Consumer scenarios reference a profile via frontmatter `auth: <name>`.

Each profile key (e.g. `admin`) supports:

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `scenario` | string | — | `frontmatter.name` of the on-demand auth scenario (e.g. `"login-admin"`) |
| `statePath` | string | `.pqa/auth/<profile>.json` | agent-browser state file path |

When a scenario uses `auth: admin`, the harness loads cached state from `statePath` or runs the auth scenario once, saves browser state, then continues. See [Auth (hybrid authStore)](#auth-hybrid-authstore).

---

#### `healing` (object, optional)

Conservative self-healing: in-run recovery and transient-only scenario retries. See [Self-healing](#self-healing-conservative).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch for in-run recovery and transient retry gating |
| `maxRecoveryTurns` | number | `2` | Extra agent turns after a failed verdict (same browser session) |
| `recoverOnUnknown` | boolean | `false` | Allow recovery when failure class is unknown but bash output looks transient |
| `transientPatterns` | string[] | see below | Substrings matched against bash output and checkpoint reasons to classify transient failures |

Default `transientPatterns`: `timeout`, `timed out`, `not found`, `waiting for`, `navigation`, `net::`, `target closed`, `detached`, `stale`, `interrupted`.

CLI equivalents: `--no-healing`, `--retries N`, `--retries-policy transient|always`, `--no-cache`.

---

#### `cache` (object, optional)

Scenario replay cache settings. See [Scenario replay cache](#scenario-replay-cache).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `dir` | string | `".pqa/cache"` | Directory for per-scenario replay hints |
| `enabled` | boolean | `true` | Master switch (opt-out via `--no-cache`) |

---

#### `recorder` (object, optional)

Settings for `pqa record`. See [Recording scenarios](#recording-scenarios).

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `bridgePort` | number | `17321` | Local HTTP port for the recording event bridge |
| `outputDir` | string | `".pqa/recordings"` | Directory for saved recording sessions |
| `defaultTags` | string[] | `["recorded"]` | Tags added to generated scenario frontmatter |

---

### Full reference example

```json
{
  "scenariosDir": "pqa",
  "systemPromptPath": "prompt/SYSTEM.md",
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

## CLI

| Command | Description |
| --- | --- |
| `pqa config <key> <value>` | Set a value in `pqa.config.json` |
| `pqa run [globs]` | Run scenarios (headless by default) |
| `pqa clear-cache [scenario]` | Clear scenario replay cache |
| `pqa debug [globs]` | Verbose debug run (headed by default, supports `--tag` / `--tags`) |
| `pqa skills list` | List discovered skills |
| `pqa skills show <name>` | Print skill body |
| `pqa skills sync` | Re-vendor agent-browser skill (dev repo only) |
| `pqa auth list` | List cached auth profiles in the auth store |
| `pqa auth clear [profile]` | Clear cached auth state |
| `pqa auth save <name>` | Run the configured auth scenario and save state |
| `pqa analyze [run...]` | Heuristic + LLM analysis, interactive patch review (REPL); multi-run flaky detection with `--last N` |
| `pqa record start` | Start headed recording session (browser + event bridge) |
| `pqa record note <text>` | Add a comment to the active recording |
| `pqa record checkpoint <text>` | Add a Then-section hint |
| `pqa record stop` | Stop recording and generate `scenarios/recorded/*.md` via LLM |
| `pqa record generate <dir>` | Regenerate scenario markdown from a saved recording |

Tag filters on `run` and `debug` can express AND/OR/NOT combinations:

```bash
# AND: scenario must have both tags
pqa run scenarios/**/*.md --tags smoke,checkout

# AND with NOT: scenario must have p0 and must not have smoke
pqa run scenarios/**/*.md --tags p0,!smoke

# OR: scenario may have either tag
pqa run scenarios/**/*.md --tag smoke --tag checkout

# OR with NOT: scenario either lacks p0 or has smoke
pqa run scenarios/**/*.md --tag !p0 --tag smoke

# Combined: (smoke AND checkout) OR auth
pqa run scenarios/**/*.md --tags smoke,checkout --tag auth
```

Use `--auth-refresh` on `run` / `debug` to re-run auth scenarios and refresh the store.

## Scenario replay cache

After a scenario passes, PQA runs a secondary LLM pass on the run transcript to produce **replay hints** under `.pqa/cache/<scenario-name>/` (`hints.md` + `meta.json`). On the next run, those hints are injected into the agent system prompt (like a skill) so the agent can follow proven `agent-browser` paths and avoid repeating costly recovery loops.

```bash
# First run: agent executes; hints are generated on pass
pqa run scenarios/lapresse/homepage-smoke.md

# Second run: agent runs with cached hints (if scenario content unchanged)
pqa run scenarios/lapresse/homepage-smoke.md

# Skip cache read/write
pqa run scenarios/**/*.md --no-cache

# Clear one or all caches
pqa clear-cache lapresse-homepage-smoke
pqa clear-cache
```

Cache is **invalidated** when the effective scenario content changes (Goal, Steps, Then, frontmatter, and expanded includes — detected via content hash). Hints are **merged and refined** on each subsequent pass. Failed runs do not update the cache.

Config (optional):

```json
{
  "cache": {
    "dir": ".pqa/cache",
    "enabled": true
  }
}
```

## Recording scenarios

Record user actions and generate a draft scenario markdown file:

```bash
pqa record start --url http://localhost:3000/projects
pqa record note "intentionally invalid date"
# interact in the browser
pqa record checkpoint 'page shows "Projects"'
pqa record stop --name my-flow
pqa debug scenarios/recorded/my-flow.md --verbose --headed
```

Events are stored under `.pqa/recordings/<timestamp>/events.jsonl`. On each interaction, the bridge runs `agent-browser snapshot -i`, matches the target to a snapshot ref (`snapshot.ref`, `snapshot.description`), and saves the tree under `snapshots/<ts>.json`. A background bridge process keeps receiving browser events until `pqa record stop` (so you can run `record note` / `record checkpoint` in another terminal while clicking in the browser). Generation uses the same LLM config as test runs (`prompt/RECORD.md`). Recorder options: see [`recorder`](#recorder-object-optional) in Configuration.

**Chrome extension (WIP):** load unpacked from [recorder-extension/](recorder-extension/README.md), run `pqa record start --connect 9222`, and use the popup for notes/checkpoints.

**Exit codes:** `0` pass · `1` failure · `2` config/harness error

## System prompt & skills

| File / skill | Role |
| --- | --- |
| [prompt/SYSTEM.md](prompt/SYSTEM.md) | Agent system prompt (workflow, verdict schema, rules) |
| `core` | Vendored agent-browser skill at `skills/agent-browser/` (bundled with the package) |

`prompt/SYSTEM.md` is loaded as the system prompt; `core` is appended as a supplemental skill. Browser control stays in bash — the agent runs `agent-browser` commands directly.

The system prompt enforces an **Observe-Act-Verify loop**: snapshot before each UI interaction, one interaction command per bash call, re-snapshot after page changes, and targeted reasoning only at ambiguous refs, failures, or before the final verdict. See [prompt/SYSTEM.md](prompt/SYSTEM.md) for details.

## Auth (hybrid authStore)

Map auth profiles to on-demand login scenarios via the [`auth`](#auth-object) config block. See [scenario format — Auth](prompt/references/scenario-format.md#auth-hybrid-authstore).

When a consumer scenario uses `auth: admin`, the harness loads cached state from `.pqa/auth/` or runs `login-admin` once, saves browser state, then continues.

```bash
# Inspect / invalidate cache
pqa auth list
pqa auth clear admin

# Force fresh login
pqa run scenarios/**/*.md --auth-refresh
```

**CI:** pass test credentials as GitHub Secrets → env vars (`PQA_TEST_EMAIL`, etc.) referenced in auth scenario Steps. Optionally pre-seed state from a base64 secret before the run.

Legacy manual capture (runs the configured auth scenario):

```bash
pqa auth save admin
```

## Self-healing (conservative)

When [`healing.enabled`](#healing-object-optional) is `true` (default), Prose-QA can:

1. **In-run recovery** — after a failed verdict, retry verification of failed checkpoints only (same browser session), for **transient** failures (timeouts, stale refs).
2. **Scenario retries** — `--retries N` with `--retries-policy transient` (default) re-runs the whole scenario only when the failure is classified transient. Use `--no-healing` for legacy behavior (any failure retries).

Checkpoints are never relaxed automatically. Passes after recovery are marked `healing.used: true` in reports.

```bash
# CI: one retry for flakes only
pqa run scenarios/**/*.md --retries 1 --retries-policy transient

# Analyze the latest run (interactive REPL)
pqa analyze

# Compare the 10 most recent runs for flaky scenarios
pqa analyze --last 10
```

All healing options: see [`healing`](#healing-object-optional) in Configuration.

## Reports

Runs write artifacts to `.pqa/runs/<runId>/`:

- `report.json` / `report.html` — summary
- `analyze.json` / `analyze-llm.json` — written by `pqa analyze` (single run)
- `.pqa/analyze/<timestamp>/analyze-flaky.json` / `analyze-llm.json` — multi-run flaky analysis
- `<scenario>/transcript.json` — bash commands + agent messages
- `<scenario>/verdict.json` — structured pass/fail

## CI

See [.github/workflows/smoke_tests.yml](.github/workflows/smoke_tests.yml). Unit tests run on every push. Optional smoke PQA runs require `ANTHROPIC_API_KEY` (or configure another provider via env).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and guidance on run artifacts and credentials.

## License

MIT — see [LICENSE](LICENSE).

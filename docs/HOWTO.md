# Prose-QA — Step-by-step guide

This guide introduces the essential **Prose-QA** (PQA) features in a progressive order: from scenario format through post-run analysis. Each section builds on the previous one.

**Common prerequisites**

- Node.js 24+ (see `engines` in `package.json`)
- `PQA_LLM_API_KEY` and `llm.provider` / `llm.model` in config (or `PQA_LLM_PROVIDER` / `PQA_LLM_MODEL`)
- Package and browser installation:

```bash
npm ci && npm run build
npx agent-browser install
export PQA_LLM_API_KEY=...
pqa config llm.provider anthropic
pqa config llm.model claude-sonnet-4-20250514
```

**Thread scenario**: [`scenarios/0_hello-world.md`](../scenarios/0_hello-world.md) and the local server:

```bash
npm run demo:server   # http://127.0.0.1:8080/ → "Hello World" (keep running in another terminal)
```

---

## 1. Scenario format (Goal / Steps / Then + frontmatter)

A PQA scenario is a Markdown file with **three required sections** and a YAML block at the top.

### Frontmatter

| Field     | Required | Role                                          |
| --------- | -------- | --------------------------------------------- |
| `name`    | yes      | Stable identifier (kebab-case)                |
| `tags`    | no       | Filter runs (`smoke`, `checkout`, …)          |
| `auth`    | no       | Profile key — run with a persisted identity   |
| `url`     | no       | URL opened before Steps                       |
| `skills`  | no       | Extra Agent Skills                            |
| `partial` | no       | `true` = includable fragment, never run alone |

### Sections

Headings must be exactly: `# Goal`, `# Steps`, `# Then` (case-insensitive).

- **Goal** — one sentence: who is acting, what to do, success criteria.
- **Steps** — numbered list; one observable action per line (click, fill, navigate).
- **Then** — **each checkpoint is a bullet starting with `-`**. Lines without `-` are not parsed.

### Minimal example

```markdown
---
name: hello-world
tags: [example]
url: http://127.0.0.1:8080/
---

# Goal

Verify the smoke test server serves a page that displays Hello World.

# Steps

1. Confirm the page has loaded.

# Then

- url contains "127.0.0.1:8080"
- page shows "Hello World"
```

### Recommended Then patterns

| Pattern      | Example                      |
| ------------ | ---------------------------- |
| URL          | `- url contains "/projects"` |
| Visible text | `- page shows "Thank you"`   |
| Field value  | `- cart count equals "3"`    |

Avoid vague wording (“the form should work”); prefer observable assertions.

### Profiles (`auth`)

Consumer scenarios declare `auth: <profile-key>` to run as an already-signed-in user. Configure the profile in `pqa.config`:

```json
{
  "auth": {
    "admin": {
      "scenario": "login-admin"
    }
  }
}
```

- **Auth scenario** (`login-admin`) — performs login; do **not** set `auth:` on it. Excluded from batch runs when referenced in config.
- **Consumer scenario** — `auth: admin` in frontmatter; harness ensures the profile exists before Steps.
- **Chrome** — profile stored under `.pqa/profiles/<key>/`
- **Lightpanda** — state JSON under `.pqa/auth/<key>.json`

Refresh a stale profile:

```bash
pqa run scenarios/checkout.md --auth-refresh
pqa auth list
pqa auth clear admin
```

### Author checklist

- [ ] Unique `name`
- [ ] All three sections present
- [ ] Every **Then** line starts with `-`
- [ ] No secrets in the file (passwords, API keys)

Detailed reference: [create-pqa-scenario](../skills/create-pqa-scenario/SKILL.md) skill.

---

## 2. Agent + agent-browser (snapshots, verifiable checkpoints)

PQA does not drive the browser from TypeScript: an **LLM agent** runs **`agent-browser`** commands via bash.

The vendored `core` skill (`skills/agent-browser/`) is synced at `npm install` via `scripts/sync-skills.mjs` and **always** injected into the system prompt (no `skills.preloads` entry required):

- **Minimal core** (`SKILL.md`, ~480 lines) is injected into the system prompt.
- **References**, **templates**, and **bundled skills** stay on disk for on-demand loading.

### On-demand skill loading

The harness exposes a `load_skill` tool so the agent can pull detailed docs only when needed (e.g. `commands`, `snapshot-refs`). Custom project skills under `skills.dirs` (default `.pqa/skills/`, e.g. `.pqa/skills/my-app/SKILL.md`) are loadable with `kind=custom`. Do not use `agent-browser skills get` in bash during a run.

| Mechanism | When |
| --------- | ---- |
| `load_skill` tool | Agent needs a reference or custom skill mid-run |
| `load_skill kind=custom` | User SKILL.md from `skills.dirs` not in preloads |
| `pqa skills sync` | Re-vendor after upgrading `agent-browser` |

Config: `skills.onDemand` in `pqa.config.*` (`enabled`, `autoLoad`, `maxChars`). See [CONFIG.md](CONFIG.md).

### Observe → Act → Verify loop

1. **Snapshot** before any UI interaction (`agent-browser snapshot -i`).
2. **Action** on a ref (`@eN`) or semantic locator — **one UI command per bash call**.
3. **Re-snapshot** after navigation, submit, or DOM change.

The system prompt system prompt enforces this loop and forbids `curl`/`wget` for UI testing.

### Then verification

After Steps, the agent verifies **every** Then checkpoint with the CLI:

| Checkpoint         | Typical command                            |
| ------------------ | ------------------------------------------ |
| `url contains "…"` | `agent-browser get url`                    |
| `page shows "…"`   | `agent-browser snapshot -i` (text present) |

On failure, artifacts are written to `$PQA_ARTIFACT_DIR` (screenshot + snapshot JSON).

### Final verdict

The agent ends with a structured JSON block (pass/fail per checkpoint). The harness parses this verdict for the report.

**Takeaway**: scenarios describe **intent**; the agent picks concrete refs and commands from snapshots.

---

## 3. `debug` vs `run`

|           | `pqa debug`                | `pqa run`             |
| --------- | -------------------------- | --------------------- |
| Use case  | Development, investigation | CI, batch regression  |
| Browser   | Headed by default          | Headless by default   |
| Verbosity | `--verbose` recommended    | Concise output        |
| Scenarios | One                        | One or multiple globs |

### Debug (single scenario, visible)

```bash
npm run demo:server &
npm run dev -- debug scenarios/0_hello-world.md --verbose
```

Useful options: `--headed` / `--no-headed`, `--tag` / `--tags`.

### Run (batch, CI)

```bash
npm run dev -- run scenarios/**/*.md --tags smoke
```

Exit codes: `0` = success · `1` = scenario failure · `2` = config/harness error.

Default browser settings: [`pqa.config.ts`](../pqa.config.ts) → `browser.headed`, `defaultTimeout`, etc.

---

## 4. Tags and batch

Tags in frontmatter let you **select** scenarios without listing every file.

```bash
# All scenarios tagged smoke
pqa run scenarios/**/*.md --tags smoke

# AND: smoke AND checkout
pqa run scenarios/**/*.md --tags smoke,checkout

# NOT: p0 but not smoke
pqa run scenarios/**/*.md --tags p0,!smoke

# OR: multiple --tag
pqa run scenarios/**/*.md --tag smoke --tag checkout
```

**Partials** (`partial: true`) are only included via body links — never run directly in batch.

---

## 5. Reports

Each run writes artifacts under **`.pqa/runs/<runId>/`**:

| File                          | Content                             |
| ----------------------------- | ----------------------------------- |
| `report.json` / `report.html` | Run summary                         |
| `<scenario>/transcript.json`  | Bash commands + agent messages      |
| `<scenario>/verdict.json`     | Structured pass/fail per checkpoint |

On debug failure, open `report.html` and the scenario’s `transcript.json` to follow snapshot → action → verification.

Variables listed in `envVars` / `sensitiveEnvVars` (config) are **redacted** in reports; secret values must not appear in plain text.

---

## 6. CI

Integrating PQA in a pipeline means: install the browser, start the app (or demo server), run `pqa run`, upload artifacts on failure.

Example in this repo: [`.github/workflows/smoke_tests.yml`](../.github/workflows/smoke_tests.yml).

```yaml
- run: npx agent-browser install --with-deps
- run: npm run build
- run: |
    npm run demo:server &
    for i in $(seq 1 30); do
      curl -sf http://127.0.0.1:8080/ | grep -q "Hello World" && break
      sleep 1
    done
- run: node dist/cli/index.js run --tag example
  env:
    PQA_LLM_API_KEY: ${{ secrets.PQA_LLM_API_KEY }}
    PQA_LLM_PROVIDER: fireworks
    PQA_LLM_MODEL: accounts/fireworks/models/deepseek-v4-flash
```

Best practices:

- GitHub Secrets → `PQA_LLM_API_KEY`, `PQA_TEST_EMAIL`, etc.
- `envVars` in `pqa.config.json` for test credentials
- `--tag example` to limit scope (bundled demo scenarios in this repo)
- Upload `.pqa/runs/` on failure (`actions/upload-artifact`)

Optional: `--retries 1 --retries-policy transient` (§10).

---

## 7. MCP + author skill

For **Cursor**, Claude Desktop, etc., the MCP server exposes scenario authoring and execution without leaving the IDE.

```bash
pqa mcp
# or from this repo:
npm run mcp
```

### Cursor configuration (consumer project)

```json
{
  "mcpServers": {
    "prose-qa": {
      "command": "npx",
      "args": ["-y", "prose-qa", "mcp"],
      "cwd": "/path/to/your-app-with-pqa.config"
    }
  }
}
```

### MCP surfaces

| Surface                                    | Role                                             |
| ------------------------------------------ | ------------------------------------------------ |
| Resource `pqa://skill/create-pqa-scenario` | Full scenario authoring skill                    |
| `get_create_pqa_scenario_skill`            | Same content as text                             |
| `validate_scenario`                        | Parse markdown **without** launching the browser |
| `run_scenario`                             | Execute inline scenario (LLM + browser required) |
| Prompt `author_pqa_scenario`               | Guided template with the skill                   |

Typical workflow: ask the agent to **author** a scenario → `validate_scenario` → `run_scenario` or commit under `scenarios/`.

---

## 8. Record → markdown

Record browser actions and produce a scenario **draft** via LLM.

```bash
pqa record start --url http://localhost:3000/projects
pqa record note "optional context for the LLM"
# interact in the browser (headed session)
pqa record checkpoint 'page shows "Projects"'
pqa record stop --name my-flow
pqa debug scenarios/recorded/my-flow.md --verbose
```

- Events: `.pqa/recordings/<timestamp>/events.jsonl`
- Snapshots: `.pqa/recordings/.../snapshots/`
- Generated file: `scenarios/recorded/<name>.md` (default tag `recorded`)

**After generation**, edit the file: condense Steps, add `tags`, partials, precise Then checkpoints.

Regenerate from a saved recording:

```bash
pqa record generate .pqa/recordings/<timestamp>
```

Chrome extension (WIP): see [`recorder-extension/README.md`](../recorder-extension/README.md).

---

## 9. Replay cache

After a **PASS**, PQA can generate **replay hints** (second LLM pass on the transcript) in `.pqa/cache/<scenario-name>/` (`hints.md` + `meta.json`). On the next run, those hints are injected into the prompt to reuse proven `agent-browser` paths.

```bash
# First run: full execution + hint generation
pqa run scenarios/0_hello-world.md

# Second run: hints used if scenario content is unchanged
pqa run scenarios/0_hello-world.md

# Disable read/write
pqa run scenarios/**/*.md --no-cache

# Invalidate
pqa clear-cache hello-world
pqa clear-cache
```

Cache is **invalidated** when the scenario hash changes (Goal, Steps, Then, frontmatter, includes). Failed runs do not update the cache.

Config: `cache.dir`, `cache.enabled` in `pqa.config.*`.

---

## 10. Healing / retries

**Conservative self-healing** (enabled by default via `healing.enabled`):

1. **In-run recovery** — after a failed verdict, re-verify failed checkpoints only (same session), for **transient** errors (timeout, stale ref, navigation).
2. **Scenario retry** — full scenario rerun when failure is classified transient.

Checkpoints are **never** relaxed automatically.

```bash
# CI: one retry for flakes
pqa run scenarios/**/*.md --retries 1 --retries-policy transient

# Disable all healing
pqa run scenarios/**/*.md --no-healing

# Retry even on non-transient failures
pqa run scenarios/**/*.md --retries 2 --retries-policy always
```

Passes after recovery are marked `healing.used: true` in reports.

---

## 11. Analyze

Analyze past runs to understand failures or detect **flakiness**.

```bash
# Latest run — interactive REPL (patch suggestions)
pqa analyze

# Compare the N most recent runs
pqa analyze --last 10
```

Typical outputs:

- `.pqa/runs/<runId>/analyze.json` and `analyze-llm.json` (single run)
- `.pqa/analyze/<timestamp>/` for multi-run flaky analysis

Related prompts: [`prompt/ANALYZE.md`](../prompt/ANALYZE.md), [`prompt/ANALYZE-FLAKY.md`](../prompt/ANALYZE-FLAKY.md).

---

## Quick path (30 min)

| Minutes | Section | Action                                                                |
| ------- | ------- | --------------------------------------------------------------------- |
| 0–10    | §1–2    | `npm run demo:server`, read `0_hello-world.md`, run `debug --verbose` |
| 10–15   | §3–4    | `run` with `--tag example`                                            |
| 15–20   | §5      | Open latest `report.html`                                             |
| 20–30   | §6      | Review `smoke_tests.yml`                                              |

Sections §7–11: separate workshop on a real app or as follow-up depth.

---

## See also

- [README.md](../README.md) — quick start and CLI
- [CONFIG.md](CONFIG.md) — full configuration reference
- [CONTRIBUTING.md](../CONTRIBUTING.md) — contributing to the repo
- [SECURITY.md](../SECURITY.md) — secrets and artifacts

# ProseQA Scenario Format

Scenarios are Markdown files with YAML frontmatter and three sections.

## Frontmatter

```yaml
---
name: checkout-happy-path   # required
tags: [smoke, checkout]     # optional — filter with pqa run --tags
auth: admin                 # optional — loads auth state from authStore
url: https://staging.example.com  # optional — agent opens this URL before Steps
skills: [core, domain-app]  # optional — extra skills loaded into the agent prompt
---
```

## Sections

### Goal

One paragraph describing the user intent. Helps the agent understand context.

When `url` is set in frontmatter, the agent navigates there automatically before executing Steps. When omitted, include explicit navigation instructions in Steps (e.g. "Open https://app.example.com/login").

`skills` lists additional Agent Skills (by name) merged into the system prompt for this scenario. Skills from linked partial scenarios (`[label](./partial.md)`) are included automatically when the parent scenario is run.

### Steps

Numbered or freeform natural-language instructions. The agent plans and executes these autonomously using agent-browser and the **Observe-Act-Verify loop** from `prompt/SYSTEM.md`:

- One observable action per step (navigate, fill, click, wait).
- Prefer visible labels and roles (“click **Save**”) over brittle CSS selectors.
- After navigation, submit, or any DOM change, the agent must re-snapshot before the next interaction.
- Keep steps atomic — avoid bundling multiple UI interactions in one instruction.

### Then

Bullet list of **regression checkpoints**. Each must be verifiable:

```markdown
# Then
- url contains "/dashboard"
- page shows "Welcome back"
- cart count equals "3"
```

## Running

```bash
# CI
pqa run scenarios/**/*.md --tags smoke

# Local debug
pqa debug scenarios/checkout.md --headed --verbose

# Force re-login for all required auth profiles
pqa run scenarios/**/*.md --auth-refresh
```

## Auth (hybrid authStore)

Consumer scenarios declare `auth: <profile>`. Auth scenarios are separate markdown files referenced from `pqa.config.ts`. They are **not** run in batch — the harness runs them on demand when the authStore has no cached state for that profile.

Configure in `pqa.config.ts`:

```typescript
auth: {
  admin: {
    scenario: "login-admin",           // frontmatter.name of auth scenario
    statePath: ".pqa/auth/admin.json",   // optional — default .pqa/auth/<profile>.json
  },
},
```

Auth scenario example (`scenarios/auth/login-admin.md`):

```yaml
---
name: login-admin
tags: [auth]
url: https://app.example.com/login
---
```

Consumer example:

```yaml
---
name: checkout-happy-path
auth: admin
url: https://app.example.com/projects
---
```

Flow:

1. Batch run excludes scenarios listed in `config.auth[*].scenario`.
2. Before running consumers, the harness ensures each required profile has state in `.pqa/auth/`.
3. If missing (or with `--auth-refresh`), the harness runs the auth scenario, saves browser state, then runs consumers with `AGENT_BROWSER_STATE`.

Credentials for login belong in environment variables (e.g. `$PQA_TEST_EMAIL`) referenced in auth scenario Steps — not in the repo.

### Manual bootstrap (legacy)

Pre-seed state without an auth scenario:

```typescript
auth: {
  admin: { statePath: ".pqa/auth/admin.json" },
},
```

Or run the configured auth scenario manually:

```bash
pqa auth save admin
```

### Auth store CLI

```bash
pqa auth list              # show cached profiles
pqa auth clear             # clear all cached state
pqa auth clear admin       # clear one profile
```

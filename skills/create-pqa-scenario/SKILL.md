---
name: prose-qa
description: >-
  Author Prose-QA E2E scenario markdown (YAML frontmatter, Goal, Steps, Then).
  Use when creating or editing scenarios under Prose-QA/scenarios, writing
  checkpoints, partials, or when the user mentions Prose-QA, pqa,
  or browser regression scenarios.
---

# Prose-QA scenario authoring

Prose-QA runs natural-language browser scenarios from markdown files in the **Prose-QA** repo (`scenarios/`). The harness parses frontmatter and three sections; an agent executes Steps with `agent-browser` and verifies **Then** checkpoints.

Canonical reference: `prompt/references/scenario-format.md`.

## File template

Use this skeleton for every new scenario:

```markdown
---
name: scenario-name
tags: [...]
url: https://app.example.com/projects
---

# Goal

One short paragraph: who is acting, what they want, and what success means.

# Steps

1. First observable action (use snapshot refs from agent-browser when UI is complex).
2. Second action.
3. Submit or navigate as needed.

# Then

- url contains "/dashboard"
- page shows "Welcome back"
```

## Frontmatter

| Field     | Required | Notes                                              |
| --------- | -------- | -------------------------------------------------- |
| `name`    | yes      | Stable kebab-case identifier                       |
| `tags`    | no       | Filter runs: `pqa run scenarios/**/*.md --tags smoke` |
| `auth`    | no       | Profile key for consumer scenarios (see below)   |
| `url`     | no       | Harness opens this before Steps when set           |
| `skills`  | no       | Extra Agent Skill names merged into the prompt     |
| `partial` | no       | `true` = include-only fragment; never run in batch |

### Auth profiles

- **Consumer scenarios** set `auth: <profile-key>` (e.g. `admin`) and are configured in `pqa.config` under `auth.<key>.scenario`.
- **Auth/login scenarios** perform sign-in; they must **not** declare `auth:` themselves. Reference them only via config.

## Sections (parser rules)

Section headers must be exactly these H1 titles (case-insensitive): `# Goal`, `# Steps`, `# Then`.

### Goal

- One paragraph of user intent and context.
- Do not duplicate step-by-step instructions here.

### Steps

- Numbered list (`1.`, `2.`, …) or clear short paragraphs.
- Each step = one agent-executable action (navigate, fill, click, wait).
- For tabular test data, use a fenced block or bullet list (see example below).
- Prefer visible labels and roles (“click **Save**”) over brittle CSS selectors.
- Keep steps atomic — one UI interaction per step; do not bundle multiple clicks in one instruction.
- After navigation or submit, instruct the agent to re-snapshot when the DOM changes (aligns with Observe-Act-Verify in `prompt/SYSTEM.md`).

### Then (critical)

**Every checkpoint must be its own bullet line starting with `-`.** The parser only collects lines that begin with `-`. Prose without a leading dash is ignored and will not be verified reliably.

Prefer machine-friendly patterns (parsed and documented in `prompt/SYSTEM.md`):

| Pattern       | Example                      |
| ------------- | ---------------------------- |
| URL substring | `- url contains "/projects"` |
| Visible text  | `- page shows "Thank you"`   |
| Field value   | `- cart count equals "3"`    |

Semantic checks are allowed when structured patterns do not fit:

```markdown
# Then

- url does not contain "/error"
- page shows validation errors for required fields
```

Keep each bullet **assertive and observable** (what the agent can confirm via `agent-browser get url` or `agent-browser snapshot`).

## Reusable fragments (partials)

Extract repeated flows into `scenarios/partials/*.md` (or link to `partial.md` as in the format reference):

```markdown
---
name: partial-block
partial: true
skills: [core]
---

Fill the client field with **Acme Corp**.
```

Include in a parent scenario body (any section):

```markdown
2. [client step](./partial.md)
3. Click **Save**.
```

- Set `partial: true` on fragments.
- Skills on partials are merged into the parent run automatically.
- Avoid circular links between `.md` files.

## Comments

- **Frontmatter**: `#` starts a YAML comment (line removed by parser).
- **Body**: `<!-- note -->` HTML comments are stripped. Do not put required steps inside HTML comments.
- **Body**: lines starting with `#` that are not section headers are kept (e.g. step notes).

## Complete example

```markdown
---
name: checkout-happy-path
tags: [smoke]
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

## Authoring checklist

Before saving a scenario file:

- [ ] `name` is unique kebab-case
- [ ] All three sections present: `# Goal`, `# Steps`, `# Then`
- [ ] Every **Then** line starts with `-`
- [ ] Checkpoints are verifiable (URL, visible text, or explicit semantic claim)
- [ ] `url` or Steps include how to reach the starting page
- [ ] `tags` set for how you plan to filter runs (`smoke`, `checkout`, etc.)
- [ ] No secrets in the file (passwords, API keys)

## Record a scenario (Prose-QA recorder)

From the Prose-QA repo, capture browser actions and generate a draft markdown file:

```bash
pqa record start --url http://localhost:3000/your-page
pqa record note "optional context for the LLM"
pqa record checkpoint 'page shows "Expected title"'
pqa record stop --name my-flow
pqa debug scenarios/recorded/my-flow.md --verbose --headed
```

Edit the generated file before committing (condense steps, add table data, partials). Recorded scenarios default-tag `recorded` (configurable via `recorder.defaultTags` in `pqa.config`).

Chrome extension for a daily browser profile: `recorder-extension/` in the Prose-QA repo (see its README).

## Validate locally

From the Prose-QA repo (start `npm run demo:server` first — bundled examples use http://127.0.0.1:8080/):

```bash
npm run dev -- debug scenarios/0_hello-world.md --verbose
# or
npm run dev -- run scenarios/**/*.md --tags example
```

Parser errors (`missing 'name'`, `Circular scenario include`) mean fix frontmatter or links before debugging the UI.

## Common mistakes

| Mistake                              | Fix                                                        |
| ------------------------------------ | ---------------------------------------------------------- |
| Then lines without `-`               | Prefix every checkpoint with `- `                          |
| Duplicate step numbers (1, 4, 5)     | Renumber Steps sequentially                                |
| Vague Then (“the form should work”)  | Split into `page shows "…"` / `url contains "…"` bullets   |

## When unsure

Read bundled examples in `scenarios/` and mirror their structure:

| File | Demonstrates |
| ---- | ------------ |
| `0_hello-world.md` | Minimal smoke |
| `1_demo-calculator-form.md` | Equation captcha (`10 − A + B = 13`) |
| `3_demo-form-playground-happy.md` | Multi-field form submission |
| `4_demo-form-validation-errors.md` | Server validation + semantic Then |
| `auth/login-admin.md` | Auth provisioning |
| `2_example-authenticated.md` | Consumer scenario with `auth:` |
| `6_demo-form-with-partial.md` | Reusable partial include |

For browser mechanics, the run uses the `agent-browser` skill from Prose-QA — scenarios should not re-document CLI flags.

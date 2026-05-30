# SAQ — Scenario Agent QA

Agent harness for **end-to-end regression testing** of web apps. Scenarios are written in natural language with explicit verification checkpoints. An LLM agent executes them using [Vercel `agent-browser`](https://github.com/vercel-labs/agent-browser) via bash — no browser wrapper in TypeScript.

## Features

- **Natural language scenarios** with `# Goal`, `# Steps`, and `# Then` checkpoints
- **Agent Skills** ([agentskills.io](https://agentskills.io/)) — Anthropic-compatible `SKILL.md` format
- **Pinned agent-browser skill** vendored at `skills/agent-browser/` (synced on postinstall)
- **CI + local debug** modes with HTML/JSON reports

## Quick start

```bash
npm install          # installs agent-browser + syncs skills
npm run build

export ANTHROPIC_API_KEY=...
export SAQ_BASE_URL=https://example.com

# CI mode
npm run dev -- run scenarios/**/*.md --tags smoke

# Debug single scenario
npm run dev -- debug scenarios/example-smoke.md --verbose
```

## Scenario format

See [skills/saq-e2e/references/scenario-format.md](skills/saq-e2e/references/scenario-format.md).

```markdown
---
name: checkout-happy-path
tags: [smoke]
auth: admin
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

Edit [saq.config.ts](saq.config.ts):

```typescript
export default {
  baseUrl: process.env.SAQ_BASE_URL ?? "http://localhost:3000",
  llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  skills: {
    dirs: ["skills", ".agents/skills"],
    preloads: ["core"],
    activate: ["saq-e2e"],
  },
  auth: {
    admin: { statePath: ".saq/auth/admin.json" },
  },
};
```

## CLI

| Command | Description |
| --- | --- |
| `saq run [globs]` | Run scenarios (headless by default) |
| `saq debug <file>` | Verbose single-scenario run |
| `saq skills list` | List discovered skills |
| `saq skills show <name>` | Print skill body |
| `saq skills sync` | Re-vendor agent-browser skill |
| `saq auth save <name> [url]` | Interactive auth state capture |

**Exit codes:** `0` pass · `1` failure · `2` config/harness error

## Skills

| Skill | Source |
| --- | --- |
| `core` | Vendored agent-browser skill at `skills/agent-browser/` (`npm run skills:sync`) |
| `saq-e2e` | Authored in [skills/saq-e2e/](skills/saq-e2e/) |

The harness preloads both skills into the agent system prompt. Browser control stays in bash — the agent runs `agent-browser` commands directly.

## Auth bootstrap

```bash
saq auth save admin https://app.example.com/login
# Add statePath to saq.config.ts auth section
```

## Reports

Runs write artifacts to `.saq/runs/<runId>/`:

- `report.json` / `report.html` — summary
- `<scenario>/transcript.json` — bash commands + agent messages
- `<scenario>/verdict.json` — structured pass/fail

## CI

See [.github/workflows/regression.yml](.github/workflows/regression.yml). Set `ANTHROPIC_API_KEY` secret and optional `SAQ_BASE_URL` variable.

## License

MIT

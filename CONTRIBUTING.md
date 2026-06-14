# Contributing to Prose-QA

Thanks for your interest in contributing.

## Development setup

```bash
git clone https://github.com/FreakDev/Prose-QA.git
cd Prose-QA
npm ci
npm run build
npm test
```

Run the CLI locally (bundled scenarios need the demo site on port 8080):

```bash
npm run demo:server   # separate terminal; serves demo-site/ at http://127.0.0.1:8080/

export PQA_LLM_API_KEY=...
pqa config llm.provider anthropic
pqa config llm.model claude-sonnet-4-20250514
npm run dev -- run scenarios/**/*.md --tags example    # CI smoke subset
npm run dev -- run scenarios/**/*.md --tags demo       # full demo suite
npm run dev -- debug scenarios/0_hello-world.md        # verbose local debug
```

Bundled scenarios live in [`scenarios/`](scenarios/) with the demo site ([`demo-site/`](demo-site/)). Add `scenarios/auth/login-admin.md` locally (see [create-pqa-scenario skill](skills/create-pqa-scenario/SKILL.md)) to run auth-dependent scenarios.

## Pull requests

1. Keep changes focused — one logical change per PR when possible.
2. Run `npm test` and `npm run build` before opening a PR.
3. Update README or scenario-format docs if you change CLI behavior or scenario syntax.
4. Do not commit secrets, `.env*` files, or app-specific scenarios (see `.gitignore`).

## Scenarios

Example scenarios live under `scenarios/`. App-specific regression suites belong in consumer repos, not in this harness repo.

See [prompt/references/scenario-format.md](prompt/references/scenario-format.md) for the scenario authoring reference. For hooks and extensions, see [docs/extensions.md](docs/extensions.md).

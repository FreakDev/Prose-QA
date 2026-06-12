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
npm run dev -- run scenarios/**/*.md --tags example --verbose   # CI smoke
npm run dev -- run scenarios/**/*.md --tags demo --verbose      # full demo suite
```

Demo site pages live in [`demo-site/`](demo-site/). Example scenarios in [`scenarios/`](scenarios/) cover smoke, forms, auth, navigation, and partials.

## Pull requests

1. Keep changes focused — one logical change per PR when possible.
2. Run `npm test` and `npm run build` before opening a PR.
3. Update README or scenario-format docs if you change CLI behavior or scenario syntax.
4. Do not commit secrets, `.env*` files, or app-specific scenarios (see `.gitignore`).

## Scenarios

Example scenarios live under `scenarios/`. App-specific regression suites belong in consumer repos, not in this harness repo.

See [prompt/references/scenario-format.md](prompt/references/scenario-format.md) for the scenario authoring reference.

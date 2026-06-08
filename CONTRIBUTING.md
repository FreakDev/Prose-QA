# Contributing to Prose-QA

Thanks for your interest in contributing.

## Development setup

```bash
git clone https://github.com/FreakDev/Prose-QA.git
cd Prose-QA
npm ci
npm run skills:sync
npm run build
npm test
```

Run the CLI locally:

```bash
export ANTHROPIC_API_KEY=...
npm run dev -- run scenarios/example-smoke.md --verbose
```

## Pull requests

1. Keep changes focused — one logical change per PR when possible.
2. Run `npm test` and `npm run build` before opening a PR.
3. Update README or scenario-format docs if you change CLI behavior or scenario syntax.
4. Do not commit secrets, `.env*` files, or app-specific scenarios (see `.gitignore`).

## Scenarios

Example scenarios live under `scenarios/`. App-specific regression suites belong in consumer repos, not in this harness repo.

See [prompt/references/scenario-format.md](prompt/references/scenario-format.md) for the scenario authoring reference.

# Prose-QA

> **Beta** — Prose-QA is under active development. Expect rough edges and breaking changes between releases.

Write what you want to test in plain text, and let Prose-QA do the rest. This autonomous, LLM-driven testing engine executes complex web workflows and validation checkpoints without the overhead of heavy browser wrappers, bringing frictionless QA to modern development.

Requires **Node.js 24+**, `PQA_LLM_API_KEY`, and `llm.provider` / `llm.model` in config.

## Quick start

```bash
npm install prose-qa

pqa config llm.provider [ollama|fireworks|openai|anthropic|google]
pqa config llm.model [model-string]

export PQA_LLM_API_KEY=...
pqa run scenarios/**/*.md
```

**New project checklist**

1. Install the package in your app repo (or globally with `npm install -g prose-qa`).
2. install a browser `pqa install-browser chrome` or `pqa install-browser lightpanda` (headless only but way lighter, perfect for CI pipeline)
3. Create `pqa.config.json` — use `pqa config <key> <value>` or copy the [minimal example](docs/CONFIG.md#minimal-example).
4. Add scenarios under `scenarios/` (see [0_hello-world.md](scenarios/0_hello-world.md)).
5. Run `pqa run` or `pqa debug`.

## What you get

- **Natural language scenarios** — `# Goal`, `# Steps`, and `# Then` checkpoints ([format guide](docs/HOWTO.md#1-scenario-format-goal--steps--then--frontmatter))
- **CI + local debug** modes with HTML/JSON reports
- **MCP Server** to help your usual agent create scenario tailored to your codebase
- **Auth, cache, healing, recording, and analysis** — see [HOWTO](docs/HOWTO.md)

## Documentation

| Doc                                                          | Purpose                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [docs/HOWTO.md](docs/HOWTO.md)                               | Step-by-step guide: scenarios → run → CI → auth → MCP → record → cache → healing → analyze |
| [docs/CONFIG.md](docs/CONFIG.md)                             | Full configuration reference                                                               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                           | Pull request guidelines                                                                    |
| [SECURITY.md](SECURITY.md)                                   | Vulnerability reporting, secrets, and run artifacts                                        |
| [recorder-extension/README.md](recorder-extension/README.md) | Chrome extension recorder (WIP)                                                            |

## CLI

| Command                                             | Description                                        |
| --------------------------------------------------- | -------------------------------------------------- |
| `pqa config <key> <value>`                          | Set a value in `pqa.config.json`                   |
| `pqa run [globs]`                                   | Run scenarios (headless by default)                |
| `pqa debug [globs]`                                 | Verbose debug run (headed by default)              |
| `pqa clear-cache [scenario]`                        | Clear scenario replay cache                        |
| `pqa auth list` / `clear` / `save`                  | Manage cached auth profiles                        |
| `pqa analyze [run...]`                              | Post-run analysis and flaky detection (`--last N`) |
| `pqa record start` / `note` / `checkpoint` / `stop` | Record browser actions → scenario markdown         |
| `pqa skills list` / `show` / `sync`                 | Discover and inspect agent skills                  |
| `pqa mcp`                                           | Start MCP server (Cursor, Claude Desktop, …)       |

Tag filters, auth refresh, retries, and cache flags: see [HOWTO §3–§4](docs/HOWTO.md#3-debug-vs-run) and [HOWTO §11](docs/HOWTO.md#11-healing--retries).

**Exit codes:** `0` pass · `1` failure · `2` config/harness error

## Configuration

Supported filenames (first match wins): `pqa.config.json`, `pqa.config.mjs`, `pqa.config.js`, `pqa.config.ts`.

```json
{
  "envVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
```

| Variable           | Required when                            |
| ------------------ | ---------------------------------------- |
| `PQA_LLM_API_KEY`  | Any cloud `llm.provider` (not `ollama`)  |
| `PQA_LLM_PROVIDER` | Optional env shortcut for `llm.provider` |
| `PQA_LLM_MODEL`    | Optional env shortcut for `llm.model`    |

All options, env vars, and a full example: **[docs/CONFIG.md](docs/CONFIG.md)**.

## MCP

Add the following to your `mcp.json`:

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

Tools: `validate_scenario`, `run_scenario`, `get_create_pqa_scenario_skill`. Details: [HOWTO §8](docs/HOWTO.md#8-mcp--author-skill).

## Development (this repo)

```bash
git clone https://github.com/FreakDev/Prose-QA.git
cd Prose-QA
npm ci && npm run install-chrome

npm run build

export PQA_LLM_API_KEY=...

npm run demo:server   # terminal 1 — http://127.0.0.1:8080/
npm run dev -- debug scenarios/0_hello-world.md
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/HOWTO.md](docs/HOWTO.md) for the full walkthrough.

## License

MIT — see [LICENSE](LICENSE).

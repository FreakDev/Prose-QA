# Prose-QA glossary

## Run unit

A single harness invocation that may run one or more consumer scenarios: `pqa run`, an isolated worker (`_run-scenario`), or MCP `run_scenario`. Each run unit executes `preBatch` (when not skipped), consumer scenarios, then `postBatch`.

## preBatch

Lifecycle hook executed once per run unit before consumer scenarios. Built-in defaults provision auth profiles required by the selected scenarios.

## postBatch

Optional lifecycle hook executed once per run unit after all consumer scenarios complete. No built-in hook is configured by default.

## Profile

Persisted user identity referenced by `auth: <key>` in a consumer scenario's frontmatter. A profile stores cookies and/or browser data so later runs can skip login. Profiles are keyed in `pqa.config` (for example `admin`).

## Browser session

Ephemeral agent-browser session name used during a single run (`pqa`, `pqa-auth-admin`, …). Not declared by scenario authors; the harness manages it.

## Scénario créateur (auth scenario)

Markdown scenario named in `config.auth.<profile>.scenario`. Its Steps perform login (or equivalent). It can run standalone for authoring, or in **provisioning** mode when the harness must create or refresh a profile.

## Mode standalone

Running an auth scenario directly (`pqa run scenarios/auth/login-admin.md`). Normal execution — no automatic profile save.

## Mode provisioning

Harness-driven execution of an auth scenario to create or refresh a profile before consumer scenarios run. Triggered by the `preBatch` hook (not a dedicated CLI command). Uses an isolated browser session and saves state when the scenario passes.

## Demo site

Fictional HTML application served locally (`npm run demo:server`) to exercise bundled PQA scenarios without an external app.

## Playground

Page on the demo site (`/playground/form`) that groups common form widgets for targeted QA scenarios.

## Consumer scenario

Scenario that declares `auth: <profile-key>` in frontmatter and runs as an already-signed-in user. Distinct from an auth scenario, which performs login itself.

## Run guard

Harness mechanism that limits agent effort when `agent-browser` bash commands fail repeatedly. Uses configurable thresholds to nudge the agent toward an early verdict, then stop with a synthetic fail verdict.

## Action overlay

In-page visual overlay shown during local Chrome headed runs to preview the agent's next browser action (ephemeral cursor and highlight) and a persistent stacked HUD panel. Distinct from verbose terminal logging. Enabled via `--action-overlay` or `extensions.actionOverlay.enabled`; on by default for `pqa debug`.

## HUD entry

One slot in the action overlay stack, tied to a single tool call preview: assistant text on top, parsed command label below in smaller type. Consecutive entries are separated by a subtle divider. Up to three entries are kept; the oldest is dropped when a fourth arrives. Entries persist until pushed out — no time-based fade or expiry. Stack order: oldest at top, newest at bottom. The stack is cleared when the harness starts a new scenario in the same browser session.

## Action overlay panel

Fixed-size draggable rectangle (320 × 280 px) hosting the HUD header and entry stack. Drag via the HUD header; panel body scrolls internally when content overflows; auto-scrolls to the newest entry on each append. Background opacity 0.7 by default, fully opaque on hover. Default position: top-right (12 px margin); user-dragged position is remembered for the rest of the browser session. Remains visible after the scenario ends until the browser window closes. The HUD header is ~36px tall (scenario name left, control icons right); the body uses the remaining height below it.

## HUD header

Top bar (~36px) of the action overlay panel: scenario name on the left (ellipsis when long), control icons on the right. **Play/pause** is a single toggle (▶ when paused, ⏸ when running); **stop** is a separate icon. Draggable via non-button areas; button clicks do not start a drag. While a scenario is running, controls are active. When the scenario ends, a short outcome suffix is appended (`passed`, `failed`, or `stopped`) and controls are disabled. When the harness starts the next scenario in the same browser session, the header resets to the new scenario name with controls re-enabled in the running state.

## Overlay control bridge

Local HTTP server started by the harness when the action overlay is enabled. The in-page overlay POSTs control events (`play`, `pause`, `stop`) to the bridge; the harness reacts immediately (turn gate, abort in-flight work). Same transport pattern as the recorder bridge, scoped to the browser session.

## Overlay turn gate

Harness pause between agent turns, controlled from the HUD header play/pause toggle when the action overlay is enabled. Default state is running (agent proceeds turn to turn). Replaces the former `--pause` CLI flag and terminal Enter resume. If pause is requested during an in-flight turn, the UI switches to the paused (▶) icon immediately; the harness finishes the current turn, then waits at the gate until play is pressed.

## Overlay stop

User-initiated abort of the **current scenario only** from the HUD header stop control. Takes effect **immediately** (within about a second): in-flight LLM and bash work is cancelled, not deferred to the next turn boundary. Ends the scenario with a harness-built synthetic **`fail`** verdict (same class as run-guard stops: verification did not complete). Does not cancel remaining scenarios in the run unit.

## Agent intent

Assistant text (`step.text`) captured from the LLM response in the same agent step as a browser action. Shown in full (never truncated) above the command label in each HUD entry. Distinct from extended thinking (`reasoningText`) and from the parsed command label itself.

## Nudge

One-time harness message injected before a hard run-guard stop, prompting the agent to conclude instead of looping on failed commands.

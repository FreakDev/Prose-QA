# ADR 0003: Overlay controls via local HTTP bridge

## Status

Accepted

## Context

The action overlay HUD is injected in-page (`window.__pqaOverlay`) and updated by the harness through `agent-browser eval`. Scenario previews and HUD entries are one-way (Node → browser). Debug operators need play/pause (turn gate) and immediate stop from the HUD header, plus the current scenario name. The former `--pause` CLI flag blocked on terminal Enter and is a poor fit for headed debug runs.

## Decision

1. Start a **local HTTP overlay control bridge** per overlay-enabled scenario (same CORS/POST pattern as the recorder bridge).
2. Inject the bridge URL into the overlay init script; the page POSTs `{ action: "play" | "pause" | "stop" }` to `/control`.
3. **Play/pause** implements an overlay turn gate (checked between agent turns; optimistic UI if pause is clicked mid-turn). Default state is running. Remove `--pause`.
4. **Stop** aborts the current scenario immediately: `AbortSignal` on `generateText`, `killAllBashProcesses` for in-flight bash, synthetic **`fail`** verdict (same class as run-guard stops).
5. HUD header shows scenario name (`frontmatter.name`), play/pause toggle, and stop icon (~36px header, panel stays 320×280). On scenario end, append outcome suffix (`passed` / `failed` / `stopped`) and disable controls. Clear entry stack and reset header when a new scenario starts in the same browser session.

## Consequences

- Overlay-enabled runs bind an ephemeral localhost port; bridge lifecycle is tied to the scenario run.
- Immediate stop depends on provider/SDK honouring `abortSignal` for LLM calls; bash is cancelled via process-tree kill.
- Controls are unavailable without the action overlay (no `--pause` fallback).

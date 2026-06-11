# ADR 0001: Auth provisioning via preBatch hooks

## Status

Accepted

## Context

Auth profile provisioning was split between CLI orchestration (`ensureAuthProfiles` in `executeRun`) and a built-in `preScenario` hook auto-injected at config load time. `pqa auth save` added a third path. Parallel workers re-provisioned per scenario.

## Decision

1. Move provisioning to **`preBatch`** via explicit `defaultExtensionHooks` in bundled config (no silent auto-inject).
2. **`preScenario`** resolves `browserContext` only (`resolveProfileHook`).
3. **`postBatch`** slot added with no built-in hook.
4. Remove **`pqa auth save`**; refresh via `pqa run … --auth-refresh`.
5. **`preBatch` always runs** (even batch of 1); parallel workers use `--skip-pre-batch` after parent provisioning.
6. Only profiles **required by the selected scenarios** are provisioned.
7. Config override is **strict** — users must spread `defaultExtensionHooks` to keep auth hooks.

## Consequences

- Single hookable path for auth across run entrypoints.
- Users who override `extensions.hooks` without defaults lose provisioning (documented; warning at run when state missing).
- Bundled `pqa.config.ts` imports `./dist/hooks/defaults.js` — requires build before loading bundled defaults in dev.

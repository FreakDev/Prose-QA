# Prose-QA glossary

## Profile

Persisted user identity referenced by `auth: <key>` in a consumer scenario's frontmatter. A profile stores cookies and/or browser data so later runs can skip login. Profiles are keyed in `pqa.config` (for example `admin`).

## Browser session

Ephemeral agent-browser session name used during a single run (`pqa`, `pqa-auth-admin`, …). Not declared by scenario authors; the harness manages it.

## Scénario créateur (auth scenario)

Markdown scenario named in `config.auth.<profile>.scenario`. Its Steps perform login (or equivalent). It can run standalone for authoring, or in **provisioning** mode when the harness must create or refresh a profile.

## Mode standalone

Running an auth scenario directly (`pqa run scenarios/auth/login-admin.md`). Normal execution — no automatic profile save.

## Mode provisioning

Harness-driven execution of an auth scenario to create or refresh a profile before consumer scenarios run. Uses an isolated browser session and saves state when the scenario passes.

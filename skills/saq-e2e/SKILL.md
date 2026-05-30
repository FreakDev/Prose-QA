---
name: saq-e2e
description: >
  Run E2E regression scenarios against a web app using agent-browser via bash.
  Use when executing SAQ scenarios, verifying Then checkpoints, capturing
  failure artifacts, or emitting structured pass/fail verdicts for CI.
allowed-tools: Bash Read
---

# SAQ E2E Regression

You execute natural-language E2E scenarios and detect regressions.

## Workflow

1. Read the scenario **Goal**, **Steps**, and **Then** checkpoints from the prompt.
2. Execute **Steps** using `agent-browser` bash commands (see the agent-browser skill).
3. After all steps, verify **every** Then checkpoint using agent-browser CLI.
4. On any checkpoint failure, capture artifacts to `$SAQ_ARTIFACT_DIR`:
   - `agent-browser screenshot "$SAQ_ARTIFACT_DIR/failure.png"`
   - `agent-browser snapshot -i --json > "$SAQ_ARTIFACT_DIR/snapshot.json"`
5. Emit a **final JSON verdict** (required — see schema below).

## Then checkpoint patterns

| Pattern | How to verify |
| --- | --- |
| `url contains "..."` | `agent-browser get url` — check substring |
| `page shows "..."` | `agent-browser snapshot -i` — check text present |
| `<field> equals "..."` | snapshot + locate field value |
| Other semantic checks | snapshot + reason about page content |

Record evidence (URL, snapshot excerpt, or command output) for each checkpoint.

## Browser session

Use environment variables when opening:

```bash
agent-browser open "$SAQ_BASE_URL"
# With auth:
agent-browser --state "$AGENT_BROWSER_STATE" open "$SAQ_BASE_URL"
```

Always re-snapshot after navigation or interaction that changes the page.

## Required final output

Your **last message** must include this JSON block:

```json
{
  "status": "pass",
  "checkpoints": [
    {
      "assertion": "url contains /order-confirmation",
      "pass": true,
      "reason": "URL is https://app.example.com/order-confirmation",
      "evidence": ["agent-browser get url output"]
    }
  ],
  "summary": "All checkpoints passed"
}
```

- `status`: `"pass"` only if **all** checkpoints pass and steps completed
- `status`: `"fail"` if any checkpoint fails or steps could not complete
- Every Then item must appear in `checkpoints`

See [scenario format reference](references/scenario-format.md) for authoring details.

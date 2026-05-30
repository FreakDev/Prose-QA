# SAQ Scenario Format

Scenarios are Markdown files with YAML frontmatter and three sections.

## Frontmatter

```yaml
---
name: checkout-happy-path   # required
tags: [smoke, checkout]     # optional — filter with saq run --tags
auth: admin                 # optional — loads auth state from saq.config.ts
baseUrl: https://staging.example.com  # optional override
---
```

## Sections

### Goal

One paragraph describing the user intent. Helps the agent understand context.

### Steps

Numbered or freeform natural-language instructions. The agent plans and executes these autonomously using agent-browser.

### Then

Bullet list of **regression checkpoints**. Each must be verifiable:

```markdown
# Then
- url contains "/dashboard"
- page shows "Welcome back"
- cart count equals "3"
```

## Running

```bash
# CI
saq run scenarios/**/*.md --tags smoke

# Local debug
saq debug scenarios/checkout.md --headed --verbose
```

## Auth

Configure in `saq.config.ts`:

```typescript
auth: {
  admin: { statePath: ".saq/auth/admin.json" },
}
```

Bootstrap with:

```bash
saq auth save admin https://app.example.com/login
```

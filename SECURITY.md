# Security Policy

## Reporting a vulnerability

Please report security issues privately by opening a [GitHub Security Advisory](https://github.com/FreakDev/Prose-QA/security/advisories/new) or emailing the maintainers. Do not open public issues for undisclosed vulnerabilities.

## Sensitive data in runs

Prose-QA runs an LLM agent against your application and writes artifacts under `.pqa/runs/`:

- Bash command transcripts
- Agent messages
- HTML/JSON reports

Variables listed in `sensitiveEnvVars` (and `PQA_LLM_API_KEY` for cloud providers) are redacted from transcripts, verdicts, and reports. Other page content, user data visible in the browser, or values typed by the agent may still appear in artifacts.

Treat run artifacts as potentially sensitive. Do not publish CI artifacts or local `.pqa/` directories without review.

## Auth and credentials

- Store test credentials in environment variables or CI secrets — never in scenario markdown.
- Cached auth state under `.pqa/auth/` contains browser session data equivalent to login cookies. Protect these files like passwords.

## Dependencies

Prose-QA depends on [agent-browser](https://github.com/vercel-labs/agent-browser) for browser automation. Keep dependencies updated and review upstream security advisories.

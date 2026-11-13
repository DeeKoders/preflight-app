# Architecture

Preflight is a modular monolith: one Express API, one React SPA, PostgreSQL for
durable state and Redis/BullMQ for background planning jobs.

```
React SPA (Vite) ──/api──▶ Express REST API ──▶ PostgreSQL (Sequelize)
                               │
                               ├─ Auth (JWT in httpOnly cookie, revocation list)
                               ├─ Jira service ──────────▶ Jira Cloud REST v3 (user's API token)
                               ├─ GitHub service ────────▶ GitHub REST (user's PAT, GET only)
                               ├─ AI provider manager ───▶ Anthropic / OpenAI / Gemini SDKs (user's key)
                               ├─ Plan service (versions, freshness, download)
                               └─ BullMQ queue ──▶ Redis ──▶ Planning worker
                                                               └─ Agent orchestrator + read-only tools
```

The worker runs inside the API process by default (`RUN_WORKER_IN_PROCESS=true`).
In production run it separately with `npm run worker -w server` and set the flag to `false`.

## Server layout

```
server/src
├── app.js / server.js / worker.js    Express app, HTTP entry point, standalone worker entry point
├── config/                           Zod-validated environment, sequelize-cli config
├── db/                               Sequelize instance, models, migrations, seeders
├── lib/                              logger (pino + redaction), errors, AES-256-GCM crypto, secret redaction
├── middleware/                       auth, validation, rate limits, error handling
├── docs/openapi.js                   OpenAPI 3 spec (served at /api/docs)
└── modules/
    ├── auth, profile                 register / login / logout / me, profile + password
    ├── jira                          client (error mapping, 429 retry, SSRF guard), ADF→Markdown, JQL builder, service, routes
    ├── github                        read-only client, repository selection
    ├── ai                            provider adapters, pricing table, BYOK settings, usage
    ├── agent                         orchestrator, tools, prompts, plan schema, evidence checks, Markdown renderer
    ├── jobs                          BullMQ queue, worker, planning processor, job API
    ├── plans                         versions, freshness, download, plan status
    └── dashboard                     overview aggregation
```

## AI provider abstraction

Each adapter in `modules/ai/providers/` implements the same interface:

| Method | Purpose |
| --- | --- |
| `validateConnection()` | Verifies the key by listing models (free call). |
| `getAvailableModels()` | Live model list for the key. |
| `generateResponse()` | Single-shot text generation (used by "Test connection"). |
| `executeAgentTurn()` | One tool-calling turn on the provider-neutral conversation format. |
| `normalizeUsage()` | Maps provider usage objects to `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`. |

Provider-specific behaviour stays inside the adapter:

- **Anthropic**: Messages API via `messages.stream().finalMessage()`. The system prompt is cached, assistant content (including thinking blocks) is replayed verbatim, `output_config.effort` is set where supported, and forced `tool_choice` is skipped on models that reject it.
- **OpenAI**: Responses API with function tools. Turns are chained with `previous_response_id`, so reasoning items carry across tool calls.
- **Gemini**: `models.generateContent` with `functionDeclarations` and `parametersJsonSchema`. Model content is replayed verbatim to keep thought signatures, and consecutive user turns are merged.

A run uses exactly the provider setting chosen when the job was created. Nothing
ever falls back to another provider or model.

## The planning agent

`modules/agent/orchestrator.js` runs four phases:

1. **Ticket understanding (deterministic).** Fetch the issue (description, acceptance-criteria custom fields, links, parent, subtasks, attachment metadata) and its comments. Compute a context hash.
2. **Investigation (model-driven).** The model chooses among read-only tools:
   `get_ticket_details`, `get_ticket_comments`, `get_linked_issues`, `search_jira_issues`,
   `get_project_details`, `get_attachment_content` and, only when a selected repository is
   included in the run, `get_repository_structure`, `search_github_code`, `get_github_file` and
   `get_project_documentation`. It ends this phase by calling `finish_investigation`.
3. **Synthesis.** Only `submit_development_plan` is offered. Its input schema is the Zod plan
   schema (`planSchema.js`). Invalid or truncated output is sent back with the validation errors
   and repaired, up to `AGENT_MAX_PLAN_REPAIRS` times.
4. **Grounding verification** (`evidence.js`):
   - Code paths the repository tools never returned are removed.
   - "Confirmed" claims about files that were listed but never read are downgraded to inferred.
   - Links are kept only for the Jira site, the selected repository, or URLs the tools actually saw.
   - Jira references to unseen issues are dropped.
   - `codebaseAnalyzed` is forced to false when no code was retrieved.
   - Leaked secrets are redacted.

   Every adjustment is recorded in the plan's assumptions and in the agent trace.

The canonical Markdown is rendered deterministically from the validated JSON plus ticket
metadata taken from Jira (`markdown.js`), so section structure is guaranteed.

### Limits

These limits prevent runaway runs and unexpected cost:

| Limit | Env var | Default |
| --- | --- | --- |
| Model turns | `AGENT_MAX_ITERATIONS` | 14 |
| Tool calls | `AGENT_MAX_TOOL_CALLS` | 30 |
| Wall-clock time | `AGENT_TIMEOUT_MS` | 10 min (passed to SDKs as an AbortSignal) |
| Total tokens per run | `AGENT_MAX_TOTAL_TOKENS` | 800k |
| Output tokens per turn | `AGENT_MAX_OUTPUT_TOKENS` | 16k |
| Tool output fed to the model | built-in | 350k chars total, 16k chars per tool result |

### Prompt-injection defence

- All Jira and GitHub content is wrapped in `<external_data … trust="untrusted">` blocks. Embedded closing tags are neutralised.
- The system policy states that such content is data, never instructions.
- The tool set is read-only by construction; no write, shell or file-system tool exists.
- Tool arguments are validated with Zod. JQL is built only from whitelisted fragments and escaped literals.
- File reads are limited to paths that exist in the selected repository's tree. Path traversal and secret-bearing files (`.env`, keys, credential files) are refused.
- Tool output and final plans pass through secret redaction.

## Jobs, retries and freshness

- `POST /api/plans` validates prerequisites up front, then creates a `planning_jobs` row. A partial unique index allows at most one queued/running job per user and ticket, which gives duplicate protection even under races. The job is then enqueued with `jobId = planning_jobs.id`.
- Retryable failures (rate limits, overload, network, 5xx) are retried with exponential backoff, up to `PLANNING_JOB_ATTEMPTS`. A retry reuses the same plan version row. Non-retryable failures (bad key, missing permissions, refusal, invalid output) fail immediately with a safe, user-facing message.
- Stalled jobs are re-queued by BullMQ. A reconciliation sweep marks DB jobs whose queue entry vanished as **failed (interrupted)**, so no job ever looks successful without having finished.
- Running jobs can be cancelled; the worker checks for cancellation at every progress checkpoint.
- Each run creates a new `development_plans` version and never overwrites an older one. A plan is **stale** when Jira's `updated` timestamp is newer than the `source_jira_updated_at` it was generated from. "Check Jira now" also compares the normalised context hash.

## Security summary

- Passwords are hashed with bcrypt (cost 12). JWTs (HS256) carry issuer and audience, live in an httpOnly `SameSite=Strict` cookie, and are revoked on logout through a denylist.
- Integration secrets are encrypted with AES-256-GCM using a 32-byte master key from `ENCRYPTION_KEY`. The ciphertext is bound by AAD to the user id and purpose, so a ciphertext copied to another row fails to decrypt. Only masked values are ever returned.
- Every query is scoped by the authenticated user id taken from the verified token. Other users' resources return 404 (IDOR protection).
- The server only calls `https://*.atlassian.net` / `*.jira.com` (configurable), which blocks SSRF via the site URL.
- Hardening: Helmet (strict CSP in production), CORS allow-list, rate limits (global, auth, credential tests, planning), Zod validation, JSON body size limit, and pino redaction of auth headers, cookies, keys and tokens.
- Markdown is rendered with `react-markdown` without raw HTML. Links are limited to http(s)/mailto/anchors and open with `rel="noopener noreferrer"`.

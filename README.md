# Preflight

Preflight is a Jira-connected AI agent that helps developers understand and plan their assigned
tickets before they write code. Each developer connects their own Jira Cloud account and their own
AI provider key (Anthropic, OpenAI or Google Gemini), and can optionally connect GitHub. When a
developer clicks **Plan It** on a ticket, a background agent investigates the ticket and its context
with read-only tools. It produces a structured, evidence-labelled development plan in Markdown,
which is versioned in PostgreSQL. Users can view, compare, download and regenerate plans, and are
told when the ticket has changed since a plan was generated.

- **Stack:** React 19 + Vite + Tailwind v4 + Radix, TanStack Query, Zustand · Express 5 (CommonJS), Sequelize, PostgreSQL, BullMQ/Redis, Zod, pino · Jest + Supertest, Vitest + Testing Library.
- **Docs:** [Architecture](docs/ARCHITECTURE.md) · [API summary](docs/API.md) · interactive OpenAPI at `http://localhost:4000/api/docs`.

---

## Quick start (local)

Requirements: **Node.js ≥ 20.19** (developed on Node 26) and **Docker** (for PostgreSQL and Redis).

```bash
# 1. Install all workspaces
npm install

# 2. Configure environment: creates .env and generates JWT_SECRET + ENCRYPTION_KEY
#    (only fills blank/placeholder values; never overwrites existing secrets)
npm run setup

# 3. Start PostgreSQL (port 5433) and Redis (port 6380)
npm run infra:up

# 4. Create the schema (dev + test databases) and an optional demo login
npm run db:migrate
npm run db:migrate:test -w server
npm run db:seed            # creates demo@preflight.local / Preflight!2026

# 5. Run API (with in-process worker) + web app
npm run dev
```

Open **http://localhost:5173**, register (or use the demo login), then:

1. **Integrations → Jira Cloud:** enter your site URL, Atlassian email and API token.
2. **AI Settings:** paste an Anthropic, OpenAI or Gemini key, pick a model, then **Verify and save** and **Test connection**.
3. *(Optional)* **Integrations → GitHub:** add a token and select the repositories the agent may read.
4. **My Tickets → Plan It.** Follow the progress screen. You can leave it; the run continues in the background and stays listed in the sidebar.
5. Read the plan, use **Copy** or **.md** to export it, **Compare** versions, and **Regenerate** when the ticket changes.

> The `.env` file lives at the repository root and is read by the server. It is git-ignored. Never commit it.
> If you edit `.env` by hand, both `JWT_SECRET` and `ENCRYPTION_KEY` must be set before the API starts; `npm run setup` fills them in for you.

## Commands

| Task | Command |
| --- | --- |
| Create `.env` / generate secrets | `npm run setup` |
| Start Postgres + Redis | `npm run infra:up` (stop: `npm run infra:down`) |
| Run migrations | `npm run db:migrate` · test DB: `npm run db:migrate:test -w server` · undo last: `npm run db:migrate:undo -w server` |
| Seed demo user | `npm run db:seed` |
| Dev (API + worker + web) | `npm run dev` |
| API only / web only | `npm run dev:server` / `npm run dev:client` |
| Standalone worker | `npm run worker -w server` (set `RUN_WORKER_IN_PROCESS=false` for the API) |
| All tests | `npm test` |
| Backend / frontend tests | `npm run test:server` / `npm run test:client` |
| Backend coverage | `npm run test:coverage -w server` |
| Production build | `npm run build` (outputs `client/dist`) |
| Production start | `npm start`. Serves the API and the built SPA on `PORT`, with a strict CSP. |

The backend tests use the `preflight_test` database, which Docker Compose creates on first start
of the Postgres volume. Migrations run automatically before the suite. **No external credentials
are needed for tests:** Jira, GitHub, the AI SDKs and the queue are all mocked.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | **yes** | — | ≥ 32 chars; signs session tokens |
| `ENCRYPTION_KEY` | **yes** | — | 32 bytes (base64 or 64 hex); AES-256-GCM master key for stored credentials. **Keep it safe.** Changing it makes saved keys undecryptable, so users must reconnect. |
| `DATABASE_URL` | | `postgres://preflight:preflight@localhost:5433/preflight` | Main database |
| `TEST_DATABASE_URL` | | `…/preflight_test` | Test database |
| `DATABASE_SSL` | | `false` | TLS to Postgres |
| `REDIS_URL` | | `redis://localhost:6380` | BullMQ |
| `RUN_WORKER_IN_PROCESS` | | `true` | Run planning worker inside the API process |
| `WORKER_CONCURRENCY` | | `2` | Parallel planning jobs per worker |
| `PORT` | | `4000` | API port |
| `CLIENT_ORIGIN` | | `http://localhost:5173` | CORS allow-list (comma separated) |
| `COOKIE_SECURE` | | `false` | Set `true` behind HTTPS |
| `TRUST_PROXY` | | `0` | Hop count when behind a reverse proxy |
| `LOG_LEVEL` | | `info` | pino level |
| `APP_NAME` | | `Preflight` | Server-side product name (logs, API docs) |
| `JIRA_ALLOWED_HOST_SUFFIXES` | | `.atlassian.net,.jira.com` | Hosts the server may call for Jira (SSRF guard) |
| `GITHUB_API_URL` | | `https://api.github.com` | GitHub API base |
| `AGENT_MAX_ITERATIONS` / `AGENT_MAX_TOOL_CALLS` / `AGENT_TIMEOUT_MS` / `AGENT_MAX_TOTAL_TOKENS` / `AGENT_MAX_OUTPUT_TOKENS` / `AGENT_MAX_PLAN_REPAIRS` | | 14 / 30 / 600000 / 800000 / 16000 / 2 | Agent safety limits |
| `PLANNING_JOB_ATTEMPTS` | | `3` | Attempts for retryable failures (exponential backoff) |
| `PRICING_OVERRIDES_JSON` | | — | Add or override model prices, e.g. `{"openai:gpt-5.2":{"input":1.5,"output":12}}` |
| `VITE_APP_NAME` (client) | | `Preflight` | Product name shown in the UI (set at build time; see `client/.env.example`) |

## Integration setup

### Jira Cloud API token
1. Go to **https://id.atlassian.com/manage-profile/security/api-tokens** and choose **Create API token**.
2. In Preflight, open **Integrations → Jira Cloud** and enter:
   - your site URL (`https://<team>.atlassian.net`)
   - your Atlassian account email
   - the token.

   Preflight calls `/rest/api/3/myself` to validate them before saving.
3. The token is encrypted at rest and never returned to the browser. Preflight only reads data;
   Jira's own permissions apply to every request. Jira Server and Data Center are not supported in
   this version. The client is structured so OAuth 2.0 (3LO) can be added later.

### AI provider keys (bring your own key)
Usage is billed by the provider to the key owner. Keys are validated against the provider when saved,
encrypted at rest, and shown only in masked form.

| Provider | Where to get a key |
| --- | --- |
| Anthropic | https://console.anthropic.com/settings/keys (suggested model: `claude-opus-5-5`; `claude-sonnet-5-5` is cheaper) |
| OpenAI | https://platform.openai.com/api-keys (Responses API with function tools) |
| Google Gemini | https://aistudio.google.com/app/apikey |

Use **Load models for this key** to pick from the models your key can actually access. Cost is
estimated only for models with a listed price (`server/src/modules/ai/pricing.js`). For any other
model the UI shows **Not available** rather than a guess. A planning run always uses the provider and
model you chose. There is no silent fallback.

### GitHub personal access token (optional)
Create a **fine-grained token** at https://github.com/settings/personal-access-tokens/new with access
to the repositories you want analysed and **read-only** `Contents` and `Metadata` permissions. Then
select those repositories and a default under **Integrations → GitHub**. The agent can list the tree,
search code, read files and docs in the selected repository, and nothing else. It never clones,
writes or opens pull requests. Without GitHub, plans state clearly that codebase analysis was unavailable.

## How a plan is produced
1. **Plan It** validates prerequisites (Jira access to the issue, AI setting, repository selection) and queues a job. Duplicate requests for the same ticket return 409 with the running job's id.
2. The worker fetches the ticket and comments, then lets the model call read-only investigation tools within strict limits.
3. The model submits the plan through a strict JSON schema. Invalid output is repaired a bounded number of times.
4. Grounding checks remove unverified file paths and links and adjust confidence levels.
5. Markdown is rendered with the 13 required sections and saved as a **new version** in PostgreSQL, together with the provider, model, token usage, estimated cost, duration, source Jira `updated` timestamp, context hash and agent trace.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details on the agent, security model and job reliability.

## Project structure

```
.
├── docker-compose.yml          Postgres 17 + Redis 7 (with test DB init script)
├── .env.example                All server configuration
├── docs/                       Architecture + API summary
├── scripts/dev.js              Runs API and web together
├── server/                     Express API (CommonJS)
│   ├── src/                    app, config, db (models/migrations/seeders), lib, middleware, modules/*
│   └── tests/                  unit/ (crypto, Jira, providers, agent) + integration/ (auth, integrations, planning, isolation)
└── client/                     React SPA
    └── src/                    pages/, components/{ui,layout,plan}, hooks/, lib/, stores/, test/
```

## Testing

- **Backend (102 tests):**
  - Unit: credential encryption, redaction, ADF and JQL, Jira error mapping and retry, SSRF guard, all three provider adapters (message conversion, tool calls, usage, error classification), cost estimation, orchestration (tool use, repairs, limits, refusals, injection wrapping), tool permissions, evidence grounding, Markdown output.
  - Integration (real Postgres): auth flows, Jira, GitHub and AI settings APIs, and the full planning flow (queue → agent → v1 → download → regenerate → v2 → stale detection) for all three providers, plus retry, cancel and interruption handling and cross-user isolation.
- **Frontend (19 tests):** login and registration, Jira connection states, ticket list, filters and Plan It, job progress states, the plan viewer (contents, safe links, collapsing, stale and old-version warnings), the diff helper, and AI settings.

## Known limitations
- **Live credentials are needed to exercise real providers.** The automated suite covers the Jira, GitHub, Anthropic, OpenAI and Gemini integrations against mocks; see the checklist below for live verification.
- **Jira Cloud only**, authenticated with personal API tokens. There is no Server/Data Center support and no OAuth yet. Ticket counts on My Tickets come from Jira's approximate-count API.
- **Attachments:** only small text-based attachments (≤ 200 KB) are read. Images, PDFs and archives are listed by name only.
- **GitHub code search** depends on GitHub's index. Very new or unindexed repositories fall back to path matching on the repository tree. Trees larger than GitHub's truncation limit are partially listed.
- **Plan checklists** are read-only in the viewer. The generated Markdown is the source of truth.
- **Cost figures** are estimates from list prices for known models. Discounts, batch pricing and OpenAI cached-input discounts are not applied.
- **`npm audit`** reports 7 moderate advisories, all transitive (`uuid` via Sequelize; `glob`/`minimatch` via sequelize-cli's beautifier) and not reachable from request handling. The suggested fixes are breaking downgrades, so they are not applied.

## Live integration checks (require your credentials)
These cannot run in CI without real accounts. Run them once after configuring keys:
1. Jira: connect, then **Test connection**. Confirm **My Tickets** lists issues and that the filters, search and pagination work.
2. Anthropic, OpenAI and Gemini: **Verify and save**, **Load models**, **Test connection** for each provider you use.
3. Plan a real ticket with each provider. Check that the progress stages advance and the plan opens with all 13 sections.
4. GitHub: connect, select a repository, plan with it selected, and confirm the plan cites real file paths.
5. Edit the Jira ticket, then use **Check Jira now** and confirm the plan shows as stale. Regenerate and compare v1 with v2.

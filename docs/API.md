# API reference

Interactive OpenAPI docs are served by the API at **`/api/docs`**, with the raw spec at
`/api/openapi.json`. This page is a compact summary.

**Conventions**
- Success responses use `{ "data": … }`.
- Errors use `{ "error": { "code", "message", "details?", "service?" } }`.
- Authenticate with the `pf_session` httpOnly cookie (set by login/register) or `Authorization: Bearer <token>`.

| Status | Meaning |
| --- | --- |
| 400 | Bad request / unsupported input |
| 401 | Not signed in, or an integration rejected its credentials (`service` is set) |
| 403 | Integration permission denied |
| 404 | Not found, or not yours |
| 409 | Conflict (e.g. a planning job is already running; `details.jobId`) |
| 422 | Validation error (`details[]` with `path` and `message`) |
| 428 | Prerequisite missing (`JIRA_NOT_CONNECTED`, `AI_NOT_CONFIGURED`, `GITHUB_NOT_CONNECTED`) |
| 429 | Rate limited (`Retry-After` header) |
| 502/503/504 | Upstream or queue unavailable |

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/register` | Create account `{name, email, password}` |
| POST | `/api/auth/login` | Sign in `{email, password}` |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Revoke current token |
| PATCH | `/api/profile` | Update name |
| POST | `/api/profile/password` | Change password |
| POST | `/api/integrations/jira/connect` | `{siteUrl, email, apiToken}`; validated via `/myself`, token encrypted |
| GET | `/api/integrations/jira/status` | Connection status (masked token) |
| POST | `/api/integrations/jira/test` | Re-test stored credentials |
| DELETE | `/api/integrations/jira` | Disconnect |
| GET | `/api/jira/tickets` | Assigned tickets. `filter=all\|in_progress\|todo\|recent\|done`, `q`, `pageToken`, `pageSize` |
| POST | `/api/jira/tickets/refresh` | Full re-sync of assigned tickets into the cache |
| GET | `/api/jira/tickets/:key` | Live ticket detail with plan status |
| POST | `/api/integrations/github/connect` | `{token}` |
| GET | `/api/integrations/github/status` | Connection status |
| POST | `/api/integrations/github/test` | Re-test token |
| PUT | `/api/integrations/github/repositories` | `{selectedRepositories[], defaultRepository}` |
| DELETE | `/api/integrations/github` | Disconnect |
| GET | `/api/github/repositories` | Repositories visible to the token |
| GET | `/api/ai/providers` | Providers and suggested models (with list prices where known) |
| GET | `/api/ai/settings` | Your provider settings (masked keys) |
| POST | `/api/ai/settings` | Create/update `{provider, model, apiKey?, isDefault?}`; new keys are validated first |
| POST | `/api/ai/settings/test` | Live test `{settingId}` or `{provider, apiKey, model}` |
| POST | `/api/ai/models` | Live model list `{settingId}` or `{provider, apiKey}` |
| POST | `/api/ai/settings/:id/default` | Make default |
| DELETE | `/api/ai/settings/:id` | Delete setting and key |
| GET | `/api/ai/usage?days=30` | Token usage and estimated cost (`null` when pricing unknown) |
| POST | `/api/plans` | Start planning `{issueKey, aiSettingId?, repository?}` → 202 job. `repository` omitted = default repo, `null` = Jira only |
| GET | `/api/plans` | Latest version per ticket. `q`, `freshness=stale\|fresh\|failed`, `provider`, `page` |
| GET | `/api/plans/:id` | Plan version with Markdown, structured JSON, agent trace |
| GET | `/api/plans/:id/versions` | All versions for that ticket |
| GET | `/api/plans/:id/versions/:version` | A specific version |
| POST | `/api/plans/:id/regenerate` | New version → 202 job |
| POST | `/api/plans/:id/freshness` | Live Jira check (timestamp + context hash) |
| GET | `/api/plans/:id/download` | `text/markdown` attachment |
| GET | `/api/planning-jobs` | Your jobs (`status=active` for queued+running) |
| GET | `/api/planning-jobs/:id` | Status, stages, activity log |
| POST | `/api/planning-jobs/:id/cancel` | Cancel queued/running job |
| GET | `/api/dashboard/overview` | Counts, recent tickets and plans |
| GET | `/api/health` | Database + Redis health |

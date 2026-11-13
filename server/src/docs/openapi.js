'use strict';

const env = require('../config/env');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const ok = (description, schema) => ({ description, content: json({ type: 'object', properties: { data: schema || { type: 'object' } } }) });
const err = (description) => ({ description, content: json(ref('Error')) });
const body = (schema, required = true) => ({ required, content: json(schema) });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const std = { 401: err('Not authenticated'), 422: err('Validation error') };

const op = (tag, summary, extra = {}) => ({ tags: [tag], summary, security: [{ cookieAuth: [] }, { bearerAuth: [] }], ...extra, responses: { ...std, ...(extra.responses || {}) } });

module.exports = {
  openapi: '3.0.3',
  info: {
    title: `${env.APP_NAME} API`,
    version: '1.0.0',
    description:
      'REST API for Preflight. All responses use `{ data }` on success and `{ error: { code, message, details? } }` on failure. Authenticate with the httpOnly `pf_session` cookie (set by login/register) or `Authorization: Bearer <token>`.',
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'pf_session' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string', example: 'JIRA_AUTH_FAILED' }, message: { type: 'string' }, details: {}, service: { type: 'string' } },
          },
        },
      },
      User: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
      Session: { type: 'object', properties: { user: ref('User'), token: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } } },
      JiraStatus: {
        type: 'object',
        properties: {
          connected: { type: 'boolean' },
          siteUrl: { type: 'string' },
          accountEmail: { type: 'string' },
          tokenMask: { type: 'string', example: 'ATAT••••a1B2' },
          jiraDisplayName: { type: 'string' },
          status: { type: 'string', enum: ['connected', 'invalid'] },
          lastValidatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TicketSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string', example: 'PROJ-123' },
          url: { type: 'string' },
          summary: { type: 'string' },
          status: { type: 'string' },
          statusCategory: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
          issueType: { type: 'string' },
          priority: { type: 'string' },
          updated: { type: 'string', format: 'date-time' },
          ticketId: { type: 'string', format: 'uuid' },
          plan: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['none', 'generating', 'ready', 'stale', 'failed'] },
              latestPlanId: { type: 'string', nullable: true },
              latestVersion: { type: 'integer', nullable: true },
              activeJobId: { type: 'string', nullable: true },
            },
          },
        },
      },
      AISetting: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] },
          model: { type: 'string' },
          keyMask: { type: 'string' },
          isDefault: { type: 'boolean' },
          validationStatus: { type: 'string', enum: ['untested', 'valid', 'invalid'] },
        },
      },
      PlanningJob: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
          currentStage: { type: 'string' },
          progress: {
            type: 'object',
            properties: {
              stages: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' } } } },
              events: { type: 'array', items: { type: 'object', properties: { at: { type: 'string' }, message: { type: 'string' }, level: { type: 'string' } } } },
            },
          },
          errorMessage: { type: 'string', nullable: true },
          planId: { type: 'string', nullable: true },
          ticket: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, summary: { type: 'string' } } },
        },
      },
      Plan: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          version: { type: 'integer' },
          status: { type: 'string', enum: ['generating', 'completed', 'failed'] },
          aiProvider: { type: 'string' },
          aiModel: { type: 'string' },
          repository: { type: 'string', nullable: true },
          isStale: { type: 'boolean' },
          markdown: { type: 'string' },
          structured: { type: 'object' },
          tokenUsage: { type: 'object' },
          sourceJiraUpdatedAt: { type: 'string', format: 'date-time' },
          sourceContextHash: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/api/health': { get: { tags: ['System'], summary: 'Health check (database + Redis)', responses: { 200: { description: 'Healthy' }, 503: { description: 'Degraded' } } } },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new account',
        requestBody: body({ type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 10 } } }),
        responses: { 201: ok('Registered', ref('Session')), 409: err('Email already registered'), 422: err('Validation error') },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in',
        requestBody: body({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }),
        responses: { 200: ok('Logged in', ref('Session')), 401: err('Invalid credentials') },
      },
    },
    '/api/auth/me': { get: op('Auth', 'Current user', { responses: { 200: ok('Current user', { type: 'object', properties: { user: ref('User') } }) } }) },
    '/api/auth/logout': { post: op('Auth', 'Log out (revokes the current token)', { responses: { 204: { description: 'Logged out' } } }) },
    '/api/profile': { patch: op('Profile', 'Update profile name', { requestBody: body({ type: 'object', properties: { name: { type: 'string' } } }), responses: { 200: ok('Updated') } }) },
    '/api/profile/password': {
      post: op('Profile', 'Change password', { requestBody: body({ type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } } }), responses: { 204: { description: 'Changed' } } }),
    },
    '/api/integrations/jira/connect': {
      post: op('Jira', 'Connect Jira Cloud (validates credentials via /myself)', {
        requestBody: body({ type: 'object', required: ['siteUrl', 'email', 'apiToken'], properties: { siteUrl: { type: 'string', example: 'https://acme.atlassian.net' }, email: { type: 'string' }, apiToken: { type: 'string' } } }),
        responses: { 201: ok('Connected', ref('JiraStatus')), 400: err('Unsupported site URL'), 502: err('Jira unreachable') },
      }),
    },
    '/api/integrations/jira/status': { get: op('Jira', 'Jira connection status', { responses: { 200: ok('Status', ref('JiraStatus')) } }) },
    '/api/integrations/jira/test': { post: op('Jira', 'Re-test stored Jira credentials', { responses: { 200: ok('OK'), 428: err('Jira not connected') } }) },
    '/api/integrations/jira': { delete: op('Jira', 'Disconnect Jira (deletes the stored token)', { responses: { 204: { description: 'Disconnected' } } }) },
    '/api/jira/tickets': {
      get: op('Jira', 'List tickets assigned to me (assignee = currentUser())', {
        parameters: [
          { name: 'filter', in: 'query', schema: { type: 'string', enum: ['all', 'in_progress', 'todo', 'done', 'recent'] } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Jira key or text' },
          { name: 'pageToken', in: 'query', schema: { type: 'string' }, description: 'nextPageToken from the previous page' },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 100 } },
        ],
        responses: {
          200: ok('Tickets', { type: 'object', properties: { tickets: { type: 'array', items: ref('TicketSummary') }, nextPageToken: { type: 'string', nullable: true }, isLast: { type: 'boolean' }, total: { type: 'integer', nullable: true } } }),
          428: err('Jira not connected'),
        },
      }),
    },
    '/api/jira/tickets/refresh': { post: op('Jira', 'Re-sync all assigned tickets into the local cache', { responses: { 200: ok('Synced') } }) },
    '/api/jira/tickets/{key}': {
      get: op('Jira', 'Ticket detail (live from Jira)', { parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Ticket'), 404: err('Not found / no permission') } }),
    },
    '/api/integrations/github/connect': {
      post: op('GitHub', 'Connect GitHub with a personal access token', { requestBody: body({ type: 'object', required: ['token'], properties: { token: { type: 'string' } } }), responses: { 201: ok('Connected') } }),
    },
    '/api/integrations/github/status': { get: op('GitHub', 'GitHub connection status', { responses: { 200: ok('Status') } }) },
    '/api/integrations/github/test': { post: op('GitHub', 'Re-test the stored GitHub token', { responses: { 200: ok('OK') } }) },
    '/api/integrations/github/repositories': {
      put: op('GitHub', 'Select repositories the agent may read, and the default', {
        requestBody: body({ type: 'object', properties: { selectedRepositories: { type: 'array', items: { type: 'string', example: 'acme/web-app' } }, defaultRepository: { type: 'string', nullable: true } } }),
        responses: { 200: ok('Saved') },
      }),
    },
    '/api/integrations/github': { delete: op('GitHub', 'Disconnect GitHub', { responses: { 204: { description: 'Disconnected' } } }) },
    '/api/github/repositories': { get: op('GitHub', 'List repositories accessible with the token', { parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { 200: ok('Repositories') } }) },
    '/api/ai/providers': { get: op('AI', 'Supported providers and suggested models', { responses: { 200: ok('Providers', { type: 'array', items: { type: 'object' } }) } }) },
    '/api/ai/settings': {
      get: op('AI', 'List my AI provider settings (keys are masked)', { responses: { 200: ok('Settings', { type: 'array', items: ref('AISetting') }) } }),
      post: op('AI', 'Create/update a provider setting. A new key is validated with the provider before being encrypted and stored.', {
        requestBody: body({ type: 'object', required: ['provider', 'model'], properties: { provider: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] }, model: { type: 'string' }, apiKey: { type: 'string' }, isDefault: { type: 'boolean' } } }),
        responses: { 201: ok('Saved', ref('AISetting')), 401: err('Provider rejected the key') },
      }),
    },
    '/api/ai/settings/test': {
      post: op('AI', 'Test a key+model with a minimal live request', {
        requestBody: body({ type: 'object', properties: { settingId: { type: 'string' }, provider: { type: 'string' }, apiKey: { type: 'string' }, model: { type: 'string' } } }),
        responses: { 200: ok('Connection OK') },
      }),
    },
    '/api/ai/models': {
      post: op('AI', 'List models available to a key', { requestBody: body({ type: 'object', properties: { settingId: { type: 'string' }, provider: { type: 'string' }, apiKey: { type: 'string' } } }), responses: { 200: ok('Models') } }),
    },
    '/api/ai/settings/{id}/default': { post: op('AI', 'Make a setting the default provider', { parameters: [idParam], responses: { 200: ok('Updated') } }) },
    '/api/ai/settings/{id}': { delete: op('AI', 'Delete a provider setting and its key', { parameters: [idParam], responses: { 204: { description: 'Deleted' } } }) },
    '/api/ai/usage': { get: op('AI', 'Token usage and estimated cost (null when pricing is unknown)', { parameters: [{ name: 'days', in: 'query', schema: { type: 'integer' } }], responses: { 200: ok('Usage') } }) },
    '/api/plans': {
      post: op('Plans', 'Start a planning job ("Plan It")', {
        requestBody: body({
          type: 'object',
          required: ['issueKey'],
          properties: {
            issueKey: { type: 'string' },
            aiSettingId: { type: 'string', description: 'Defaults to your default provider' },
            repository: { type: 'string', nullable: true, description: 'owner/name; omit for default repo, null for Jira-only' },
          },
        }),
        responses: { 202: ok('Job queued', ref('PlanningJob')), 409: err('A job for this ticket is already running'), 428: err('Jira or AI provider not configured') },
      }),
      get: op('Plans', 'List my plans (latest version per ticket)', {
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'freshness', in: 'query', schema: { type: 'string', enum: ['stale', 'fresh', 'failed'] } },
          { name: 'provider', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: ok('Plans') },
      }),
    },
    '/api/plans/{id}': { get: op('Plans', 'Plan version with Markdown and structured content', { parameters: [idParam], responses: { 200: ok('Plan', ref('Plan')), 404: err('Not found') } }) },
    '/api/plans/{id}/versions': { get: op('Plans', 'All versions for the plan\'s ticket', { parameters: [idParam], responses: { 200: ok('Versions') } }) },
    '/api/plans/{id}/versions/{version}': {
      get: op('Plans', 'A specific version', { parameters: [idParam, { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: ok('Plan', ref('Plan')) } }),
    },
    '/api/plans/{id}/regenerate': {
      post: op('Plans', 'Generate a new version (previous versions are preserved)', { parameters: [idParam], requestBody: body({ type: 'object', properties: { aiSettingId: { type: 'string' }, repository: { type: 'string', nullable: true } } }, false), responses: { 202: ok('Job queued', ref('PlanningJob')) } }),
    },
    '/api/plans/{id}/freshness': { post: op('Plans', 'Live check whether Jira changed since the plan was generated', { parameters: [idParam], responses: { 200: ok('Freshness') } }) },
    '/api/plans/{id}/download': { get: op('Plans', 'Download Markdown', { parameters: [idParam], responses: { 200: { description: 'text/markdown file' } } }) },
    '/api/planning-jobs': { get: op('Planning jobs', 'List my planning jobs', { parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: ok('Jobs') } }) },
    '/api/planning-jobs/{id}': { get: op('Planning jobs', 'Job status and stage progress', { parameters: [idParam], responses: { 200: ok('Job', ref('PlanningJob')) } }) },
    '/api/planning-jobs/{id}/cancel': { post: op('Planning jobs', 'Cancel a queued or running job', { parameters: [idParam], responses: { 200: ok('Cancelled', ref('PlanningJob')), 409: err('Job already finished') } }) },
    '/api/dashboard/overview': { get: op('Dashboard', 'Overview counts, recent plans and tickets', { responses: { 200: ok('Overview') } }) },
  },
};

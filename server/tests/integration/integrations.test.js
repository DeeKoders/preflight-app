const { registerUser } = require('../helpers/app');
const { resetDb, db } = require('../helpers/db');
const { fakeJiraClient, scriptedAdapter } = require('../helpers/fixtures');
const jiraService = require('../../src/modules/jira/jira.service');
const githubService = require('../../src/modules/github/github.service');
const { setProviderFactory } = require('../../src/modules/ai/providers');
const { IntegrationError } = require('../../src/lib/errors');

let jira;
beforeEach(async () => {
  await resetDb();
  jira = fakeJiraClient();
  jiraService.setClientFactory(() => jira);
});
afterAll(() => db.sequelize.close());

describe('Jira integration', () => {
  it('shows a setup state before connecting', async () => {
    const u = await registerUser();
    expect((await u.get('/api/integrations/jira/status')).body.data).toEqual({ connected: false });
    const tickets = await u.get('/api/jira/tickets');
    expect(tickets.status).toBe(428);
    expect(tickets.body.error.code).toBe('JIRA_NOT_CONNECTED');
  });

  it('validates credentials, encrypts the token and never returns it', async () => {
    const u = await registerUser();
    const res = await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'ATATT3xFfGF0-super-secret-token-value' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ connected: true, siteUrl: 'https://acme.atlassian.net', jiraDisplayName: 'Dev Eloper', status: 'connected' });
    expect(JSON.stringify(res.body)).not.toContain('super-secret-token-value');
    const row = await db.JiraIntegration.findOne({ where: { userId: u.user.id } });
    expect(row.encryptedApiToken).not.toContain('super-secret');
    expect(JSON.stringify((await u.get('/api/integrations/jira/status')).body)).not.toContain('super-secret');
  });

  it('rejects non-Jira-Cloud hosts and invalid credentials', async () => {
    const u = await registerUser();
    expect((await u.post('/api/integrations/jira/connect', { siteUrl: 'https://internal.corp', email: 'dev@acme.com', apiToken: 'xxxxxxxxxxxx' })).status).toBe(400);
    jira.getMyself = async () => {
      throw new IntegrationError({ service: 'jira', code: 'JIRA_AUTH_FAILED', message: 'bad creds', status: 401 });
    };
    const res = await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'xxxxxxxxxxxx' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'JIRA_AUTH_FAILED', service: 'jira' });
    expect(await db.JiraIntegration.count()).toBe(0);
  });

  it('lists assigned tickets with plan status, caches them minimally, and fetches detail', async () => {
    const u = await registerUser();
    await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'ATATT3xFfGF0-token' });
    const res = await u.get('/api/jira/tickets?filter=in_progress&q=export');
    expect(res.status).toBe(200);
    expect(res.body.data.tickets[0]).toMatchObject({ key: 'PROJ-1', status: 'In Progress', priority: 'High', plan: { status: 'none' } });
    expect(res.body.data.jql).toContain('statusCategory = "In Progress"');
    expect(await db.Ticket.count({ where: { userId: u.user.id } })).toBe(1);
    const detail = await u.get('/api/jira/tickets/proj-1');
    expect(detail.body.data).toMatchObject({ key: 'PROJ-1', parent: { key: 'PROJ-100' } });
    expect((await u.get('/api/jira/tickets/not-a-key!')).status).toBe(422);
  });

  it('marks the connection invalid when Jira revokes the token', async () => {
    const u = await registerUser();
    await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'ATATT3xFfGF0-token' });
    jira.searchIssues = async () => {
      throw new IntegrationError({ service: 'jira', code: 'JIRA_AUTH_FAILED', message: 'revoked', status: 401 });
    };
    expect((await u.get('/api/jira/tickets')).status).toBe(401);
    expect((await u.get('/api/integrations/jira/status')).body.data.status).toBe('invalid');
  });

  it('disconnects', async () => {
    const u = await registerUser();
    await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'ATATT3xFfGF0-token' });
    expect((await u.delete('/api/integrations/jira')).status).toBe(204);
    expect((await u.get('/api/integrations/jira/status')).body.data.connected).toBe(false);
  });
});

describe('GitHub integration', () => {
  const gh = {
    getUser: async () => ({ login: 'octo', name: 'Octo' }),
    listRepos: async () => [{ full_name: 'acme/web', private: true, default_branch: 'main', html_url: 'https://github.com/acme/web' }],
    getRepo: async (name) => {
      if (name !== 'acme/web') throw new IntegrationError({ service: 'github', code: 'GITHUB_NOT_FOUND', message: 'nf', status: 404 });
      return { full_name: name, default_branch: 'main' };
    },
  };
  beforeEach(() => githubService.setClientFactory(() => gh));

  it('connects, lists and selects repositories', async () => {
    const u = await registerUser();
    const res = await u.post('/api/integrations/github/connect', { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ githubUsername: 'octo', selectedRepositories: [] });
    expect(JSON.stringify(res.body)).not.toContain('abcdefghijklmnop');
    expect((await u.get('/api/github/repositories')).body.data.repositories[0].fullName).toBe('acme/web');
    expect((await u.put('/api/integrations/github/repositories', { selectedRepositories: ['acme/private'] })).status).toBe(404);
    const saved = await u.put('/api/integrations/github/repositories', { selectedRepositories: ['acme/web'], defaultRepository: 'acme/web' });
    expect(saved.body.data).toMatchObject({ selectedRepositories: ['acme/web'], defaultRepository: 'acme/web' });
  });
});

describe('AI provider settings (BYOK)', () => {
  let adapter;
  beforeEach(() => {
    adapter = scriptedAdapter([]);
    setProviderFactory(() => adapter);
  });

  it('validates, encrypts and masks keys; never returns them', async () => {
    const u = await registerUser();
    const key = 'sk-ant-api03-SUPERSECRETKEYVALUE1234';
    const res = await u.post('/api/ai/settings', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: key });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', isDefault: true, validationStatus: 'valid', keyMask: 'sk-ant-••••1234' });
    expect(JSON.stringify(res.body)).not.toContain('SUPERSECRET');
    const row = await db.AIProviderSetting.findOne({ where: { userId: u.user.id } });
    expect(row.encryptedApiKey).not.toContain('SUPERSECRET');
    expect(JSON.stringify((await u.get('/api/ai/settings')).body)).not.toContain('SUPERSECRET');
  });

  it('requires a key for new providers and rejects invalid keys', async () => {
    const u = await registerUser();
    expect((await u.post('/api/ai/settings', { provider: 'openai', model: 'gpt-5' })).status).toBe(400);
    adapter.validateConnection = async () => {
      throw new IntegrationError({ service: 'openai', code: 'AI_AUTH_FAILED', message: 'bad key', status: 401 });
    };
    const res = await u.post('/api/ai/settings', { provider: 'openai', model: 'gpt-5', apiKey: 'sk-invalid-key-123456' });
    expect(res.status).toBe(401);
    expect(await db.AIProviderSetting.count()).toBe(0);
  });

  it('supports multiple providers with a single default, model updates without re-entering the key, and deletion', async () => {
    const u = await registerUser();
    const a = (await u.post('/api/ai/settings', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-api03-key-aaaaaaaa' })).body.data;
    const o = (await u.post('/api/ai/settings', { provider: 'openai', model: 'gpt-5', apiKey: 'sk-proj-key-bbbbbbbbbbbb', isDefault: true })).body.data;
    let list = (await u.get('/api/ai/settings')).body.data;
    expect(list.filter((s) => s.isDefault).map((s) => s.id)).toEqual([o.id]);
    const updated = await u.post('/api/ai/settings', { provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(updated.body.data).toMatchObject({ id: a.id, model: 'claude-sonnet-5-5', keyMask: a.keyMask });
    expect((await u.delete(`/api/ai/settings/${o.id}`)).status).toBe(204);
    list = (await u.get('/api/ai/settings')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, isDefault: true });
  });

  it('tests a connection with a live request and records usage', async () => {
    const u = await registerUser();
    const s = (await u.post('/api/ai/settings', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-api03-key-aaaaaaaa' })).body.data;
    const res = await u.post('/api/ai/settings/test', { settingId: s.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, provider: 'anthropic', model: 'claude-opus-5-5' });
    const usage = (await u.get('/api/ai/usage')).body.data;
    expect(usage.totals.requests).toBe(1);
    expect(usage.breakdown[0]).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', costAvailable: true });
  });

  it('lists providers with suggested models', async () => {
    const u = await registerUser();
    const ids = (await u.get('/api/ai/providers')).body.data.map((p) => p.id);
    expect(ids).toEqual(['anthropic', 'openai', 'gemini']);
  });
});

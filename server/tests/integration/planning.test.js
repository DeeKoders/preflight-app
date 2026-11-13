jest.mock('../../src/modules/jobs/queue', () => ({
  enqueuePlanningJob: jest.fn(async () => ({})),
  removeQueuedJob: jest.fn(async () => true),
  getQueueJobState: jest.fn(async () => null),
  pingRedis: jest.fn(async () => true),
  closeQueue: jest.fn(async () => {}),
}));

const { registerUser } = require('../helpers/app');
const { resetDb, db } = require('../helpers/db');
const { fakeJiraClient, scriptedAdapter, validPlan, call, rawIssue } = require('../helpers/fixtures');
const jiraService = require('../../src/modules/jira/jira.service');
const githubService = require('../../src/modules/github/github.service');
const { setProviderFactory } = require('../../src/modules/ai/providers');
const queue = require('../../src/modules/jobs/queue');
const { processPlanningJob } = require('../../src/modules/jobs/planning.processor');
const { reconcileOrphanedJobs } = require('../../src/modules/jobs/worker');
const { IntegrationError } = require('../../src/lib/errors');

let jira;
let adapterFor;
const bullJob = (id, attemptsMade = 0, attempts = 3) => ({ data: { planningJobId: id }, attemptsMade, opts: { attempts } });

const happyScript = () => [
  { toolCalls: [call('get_linked_issues', { issueKey: 'PROJ-1' })] },
  { toolCalls: [call('finish_investigation', { summary: 'ok' })] },
  { toolCalls: [call('submit_development_plan', validPlan())] },
];

async function setupUser() {
  const u = await registerUser();
  await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'ATATT3xFfGF0-token' });
  await u.post('/api/ai/settings', { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-api03-key-aaaaaaaa' });
  return u;
}

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  jira = fakeJiraClient();
  jiraService.setClientFactory(() => jira);
  adapterFor = () => scriptedAdapter(happyScript());
  setProviderFactory((provider, key) => adapterFor(provider, key));
});
afterAll(() => db.sequelize.close());

describe('planning flow', () => {
  it('requires Jira and an AI provider', async () => {
    const u = await registerUser();
    const res = await u.post('/api/plans', { issueKey: 'PROJ-1' });
    expect(res.status).toBe(428);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('runs end-to-end: queue → agent → versioned plan → download → regenerate → stale detection', async () => {
    const u = await setupUser();
    const start = await u.post('/api/plans', { issueKey: 'PROJ-1', repository: null });
    expect(start.status).toBe(202);
    const job = start.body.data;
    expect(job).toMatchObject({ status: 'queued', ticket: { key: 'PROJ-1' }, provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(queue.enqueuePlanningJob).toHaveBeenCalledWith(job.id);

    // Duplicate requests are rejected while a job is active.
    const dup = await u.post('/api/plans', { issueKey: 'PROJ-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.jobId).toBe(job.id);

    await processPlanningJob(bullJob(job.id));
    const done = (await u.get(`/api/planning-jobs/${job.id}`)).body.data;
    expect(done.status).toBe('completed');
    expect(done.progress.stages.map((s) => [s.id, s.status])).toEqual([
      ['fetch_ticket', 'done'],
      ['understand_requirements', 'done'],
      ['investigate_jira', 'done'],
      ['explore_codebase', 'skipped'],
      ['draft_plan', 'done'],
      ['validate_plan', 'done'],
      ['save_plan', 'done'],
    ]);

    const plan = (await u.get(`/api/plans/${done.planId}`)).body.data;
    expect(plan).toMatchObject({ version: 1, status: 'completed', aiProvider: 'anthropic', aiModel: 'claude-opus-5-5', isStale: false, isLatest: true });
    expect(plan.markdown).toMatch(/^# Development Plan — PROJ-1/);
    expect(plan.structured.businessObjective).toBeTruthy();
    expect(plan.tokenUsage).toMatchObject({ inputTokens: 300, outputTokens: 150, requests: 3 });
    expect(plan.tokenUsage.estimatedCostUsd).toBeGreaterThan(0);
    expect(plan.sourceContextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.AIUsageLog.count({ where: { planningJobId: job.id } })).toBe(3);

    const dl = await u.get(`/api/plans/${plan.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/text\/markdown/);
    expect(dl.headers['content-disposition']).toContain('PROJ-1-development-plan-v1.md');
    expect(dl.text).toBe(plan.markdown);

    // Regenerate → version 2; version 1 preserved.
    const regen = await u.post(`/api/plans/${plan.id}/regenerate`, { repository: null });
    expect(regen.status).toBe(202);
    await processPlanningJob(bullJob(regen.body.data.id));
    const versions = (await u.get(`/api/plans/${plan.id}/versions`)).body.data;
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const v1 = (await u.get(`/api/plans/${plan.id}/versions/1`)).body.data;
    expect(v1.markdown).toBe(plan.markdown);
    expect((await u.get(`/api/plans/${plan.id}`)).body.data.isLatest).toBe(false);

    // Jira changes after generation → stale.
    jira.searchIssues = async () => ({ issues: [rawIssue({ fields: { updated: '2026-12-01T00:00:00.000+0000' } })], isLast: true });
    await u.get('/api/jira/tickets');
    const list = (await u.get('/api/plans')).body.data;
    expect(list.plans).toHaveLength(1);
    expect(list.plans[0]).toMatchObject({ version: 2, versionCount: 2, isStale: true });
    expect((await u.get('/api/plans?freshness=stale')).body.data.total).toBe(1);
    const tickets = (await u.get('/api/jira/tickets')).body.data.tickets;
    expect(tickets[0].plan).toMatchObject({ status: 'stale', latestVersion: 2 });

    // Live freshness check compares the context hash too.
    jira.getIssue = async () => rawIssue({ fields: { updated: '2026-12-01T00:00:00.000+0000', summary: 'Changed summary' } });
    const fresh = (await u.post(`/api/plans/${list.plans[0].id}/freshness`)).body.data;
    expect(fresh).toMatchObject({ stale: true, contentChanged: true, timestampChanged: true });

    const overview = (await u.get('/api/dashboard/overview')).body.data;
    expect(overview.counts).toMatchObject({ assigned: 1, withPlans: 1, stalePlans: 1, totalPlans: 2 });
  });

  it.each(['openai', 'gemini'])('works with %s as the configured provider (no silent switching)', async (provider) => {
    const u = await registerUser();
    await u.post('/api/integrations/jira/connect', { siteUrl: 'acme.atlassian.net', email: 'dev@acme.com', apiToken: 'ATATT3xFfGF0-token' });
    const used = [];
    adapterFor = (p) => (used.push(p), scriptedAdapter(happyScript()));
    await u.post('/api/ai/settings', { provider, model: provider === 'openai' ? 'gpt-5' : 'gemini-2.5-pro', apiKey: 'key-value-1234567890' });
    const job = (await u.post('/api/plans', { issueKey: 'PROJ-1' })).body.data;
    await processPlanningJob(bullJob(job.id));
    const plan = (await u.get(`/api/plans/${(await u.get(`/api/planning-jobs/${job.id}`)).body.data.planId}`)).body.data;
    expect(plan.aiProvider).toBe(provider);
    expect(new Set(used)).toEqual(new Set([provider]));
  });

  it('retries retryable failures and fails permanently on non-retryable ones without claiming success', async () => {
    const u = await setupUser();
    const job = (await u.post('/api/plans', { issueKey: 'PROJ-1', repository: null })).body.data;
    adapterFor = () => ({
      ...scriptedAdapter([]),
      executeAgentTurn: async () => {
        throw new IntegrationError({ service: 'anthropic', code: 'AI_RATE_LIMITED', message: 'rate limited', status: 429, retryable: true });
      },
    });
    await expect(processPlanningJob(bullJob(job.id, 0, 3))).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    let state = (await u.get(`/api/planning-jobs/${job.id}`)).body.data;
    expect(state.status).toBe('queued');
    expect(state.errorMessage).toMatch(/Retrying/);

    adapterFor = () => ({
      ...scriptedAdapter([]),
      executeAgentTurn: async () => {
        throw new IntegrationError({ service: 'anthropic', code: 'AI_AUTH_FAILED', message: 'Anthropic rejected the API key.', status: 401 });
      },
    });
    await expect(processPlanningJob(bullJob(job.id, 1, 3))).rejects.toThrow('Anthropic rejected the API key.');
    state = (await u.get(`/api/planning-jobs/${job.id}`)).body.data;
    expect(state.status).toBe('failed');
    expect(state.errorMessage).toBe('Anthropic rejected the API key.');
    const plan = await db.DevelopmentPlan.findByPk(state.planId);
    expect(plan.generationStatus).toBe('failed');
    expect(plan.errorDetails).toMatchObject({ code: 'AI_AUTH_FAILED' });
    expect(plan.version).toBe(1); // the retry reused the same version row
    expect(JSON.stringify(plan.errorDetails)).not.toContain('sk-ant');
  });

  it('cancels queued jobs and reconciles interrupted ones', async () => {
    const u = await setupUser();
    const job = (await u.post('/api/plans', { issueKey: 'PROJ-1', repository: null })).body.data;
    expect((await u.post(`/api/planning-jobs/${job.id}/cancel`)).body.data.status).toBe('cancelled');
    expect((await u.post(`/api/planning-jobs/${job.id}/cancel`)).status).toBe(409);
    await expect(processPlanningJob(bullJob(job.id))).resolves.toEqual({ skipped: true });

    const job2 = (await u.post('/api/plans', { issueKey: 'PROJ-1', repository: null })).body.data;
    await db.PlanningJob.update({ status: 'running' }, { where: { id: job2.id } });
    await db.sequelize.query(`UPDATE planning_jobs SET updated_at = NOW() - interval '10 minutes' WHERE id = '${job2.id}'`);
    queue.getQueueJobState.mockResolvedValueOnce(null);
    expect(await reconcileOrphanedJobs()).toBe(1);
    expect((await u.get(`/api/planning-jobs/${job2.id}`)).body.data).toMatchObject({ status: 'failed', errorMessage: expect.stringMatching(/interrupted/) });
  });

  it('only allows selected repositories for codebase analysis', async () => {
    const u = await setupUser();
    githubService.setClientFactory(() => ({ getUser: async () => ({ login: 'octo' }), getRepo: async (n) => ({ full_name: n, default_branch: 'main' }) }));
    await u.post('/api/integrations/github/connect', { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await u.put('/api/integrations/github/repositories', { selectedRepositories: ['acme/web'] });
    expect((await u.post('/api/plans', { issueKey: 'PROJ-1', repository: 'other/repo' })).status).toBe(400);
    const job = (await u.post('/api/plans', { issueKey: 'PROJ-1' })).body.data;
    expect(job.repository).toBe('acme/web'); // default repository used when omitted
  });
});

describe('user data isolation', () => {
  it('prevents cross-user access to plans, jobs, settings and credentials', async () => {
    const alice = await setupUser();
    const bob = await registerUser();
    const job = (await alice.post('/api/plans', { issueKey: 'PROJ-1', repository: null })).body.data;
    await processPlanningJob(bullJob(job.id));
    const planId = (await alice.get(`/api/planning-jobs/${job.id}`)).body.data.planId;
    const aliceSetting = (await alice.get('/api/ai/settings')).body.data[0];

    for (const url of [`/api/plans/${planId}`, `/api/plans/${planId}/versions`, `/api/plans/${planId}/versions/1`, `/api/plans/${planId}/download`, `/api/planning-jobs/${job.id}`]) {
      const res = await bob.get(url);
      expect([url, res.status]).toEqual([url, 404]);
    }
    expect((await bob.post(`/api/plans/${planId}/regenerate`, {})).status).not.toBe(202);
    expect((await bob.post(`/api/planning-jobs/${job.id}/cancel`)).status).toBe(404);
    expect((await bob.delete(`/api/ai/settings/${aliceSetting.id}`)).status).toBe(404);
    expect((await bob.post('/api/ai/settings/test', { settingId: aliceSetting.id })).status).toBe(404);
    expect((await bob.post('/api/plans', { issueKey: 'PROJ-1', aiSettingId: aliceSetting.id })).status).toBe(428);
    expect((await bob.get('/api/plans')).body.data.plans).toEqual([]);
    expect((await bob.get('/api/ai/settings')).body.data).toEqual([]);
    expect((await bob.get('/api/integrations/jira/status')).body.data).toEqual({ connected: false });
    expect((await bob.get('/api/ai/usage')).body.data.totals.requests).toBe(0);
    expect(await db.AIProviderSetting.count({ where: { userId: alice.user.id } })).toBe(1);
  });

  it('a ciphertext copied to another user cannot be decrypted', async () => {
    const alice = await setupUser();
    const bob = await registerUser();
    const row = await db.AIProviderSetting.findOne({ where: { userId: alice.user.id } });
    await db.AIProviderSetting.create({ userId: bob.user.id, provider: 'anthropic', model: 'claude-opus-5-5', encryptedApiKey: row.encryptedApiKey, keyMask: 'x', isDefault: true });
    const s = (await bob.get('/api/ai/settings')).body.data[0];
    const res = await bob.post('/api/ai/settings/test', { settingId: s.id });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('sk-ant');
  });
});

'use strict';

const { JiraIntegration, Ticket } = require('../../db');
const { encryptSecret, decryptSecret, maskSecret } = require('../../lib/crypto');
const { preconditionRequired, IntegrationError } = require('../../lib/errors');
const logger = require('../../lib/logger');
const { JiraClient, normalizeSiteUrl } = require('./jira.client');
const { buildAssignedJql } = require('./jql');
const { normalizeIssueSummary, normalizeIssueDetail } = require('./jira.normalize');
const { getPlanStatusForTickets } = require('../plans/planStatus');

const LIST_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'updated', 'project'];
const tokenContext = (userId) => `jira-token:${userId}`;

// Factory is swappable so tests can inject a mocked HTTP client.
let clientFactory = (opts) => new JiraClient(opts);
const setClientFactory = (fn) => {
  clientFactory = fn;
};

async function getIntegration(userId) {
  return JiraIntegration.findOne({ where: { userId } });
}

async function getClient(userId) {
  const integration = await getIntegration(userId);
  if (!integration) throw preconditionRequired('JIRA_NOT_CONNECTED', 'Connect your Jira account on the Integrations page first.');
  const apiToken = decryptSecret(integration.encryptedApiToken, tokenContext(userId));
  return { integration, client: clientFactory({ siteUrl: integration.siteUrl, email: integration.accountEmail, apiToken }) };
}

/** Wraps a Jira call so auth failures flag the stored connection as invalid. */
async function withJira(userId, fn) {
  const { integration, client } = await getClient(userId);
  try {
    return await fn(client, integration);
  } catch (err) {
    if (err instanceof IntegrationError && err.code === 'JIRA_AUTH_FAILED' && integration.status !== 'invalid') {
      await integration.update({ status: 'invalid', lastError: err.message });
    }
    throw err;
  }
}

async function connect(userId, { siteUrl, email, apiToken }) {
  const normalizedUrl = normalizeSiteUrl(siteUrl);
  const client = clientFactory({ siteUrl: normalizedUrl, email, apiToken });
  const me = await client.getMyself(); // throws a mapped IntegrationError on failure
  if (!me?.accountId) {
    throw new IntegrationError({ service: 'jira', code: 'JIRA_UNSUPPORTED', message: 'The Jira site did not return a valid user profile.', status: 502 });
  }
  const values = {
    userId,
    siteUrl: normalizedUrl,
    accountEmail: email,
    encryptedApiToken: encryptSecret(apiToken, tokenContext(userId)),
    tokenMask: maskSecret(apiToken),
    jiraAccountId: me.accountId,
    jiraDisplayName: me.displayName || null,
    status: 'connected',
    lastError: null,
    connectedAt: new Date(),
    lastValidatedAt: new Date(),
  };
  const existing = await getIntegration(userId);
  if (existing && existing.siteUrl !== normalizedUrl) {
    // Different Jira site: cached tickets belong to the old site, drop them (plans cascade with tickets).
    logger.info({ userId }, 'Jira site changed; clearing cached tickets');
    await Ticket.destroy({ where: { userId } });
  }
  const integration = existing ? await existing.update(values) : await JiraIntegration.create(values);
  return integration.toSafeJSON();
}

async function status(userId) {
  const integration = await getIntegration(userId);
  return integration ? integration.toSafeJSON() : { connected: false };
}

async function test(userId) {
  const { integration, client } = await getClient(userId);
  try {
    const me = await client.getMyself();
    await integration.update({ status: 'connected', lastError: null, lastValidatedAt: new Date(), jiraDisplayName: me.displayName || integration.jiraDisplayName });
    return { ok: true, account: { accountId: me.accountId, displayName: me.displayName, emailAddress: me.emailAddress || integration.accountEmail } };
  } catch (err) {
    if (err instanceof IntegrationError && ['JIRA_AUTH_FAILED', 'JIRA_FORBIDDEN'].includes(err.code)) {
      await integration.update({ status: 'invalid', lastError: err.message, lastValidatedAt: new Date() });
    }
    throw err;
  }
}

async function disconnect(userId) {
  await JiraIntegration.destroy({ where: { userId } });
}

/** Upserts the minimal cached ticket rows and returns them keyed by Jira issue id. */
async function cacheTickets(userId, summaries) {
  if (!summaries.length) return new Map();
  const now = new Date();
  await Ticket.bulkCreate(
    summaries.map((s) => ({
      userId,
      jiraIssueId: s.id,
      jiraIssueKey: s.key,
      projectKey: s.projectKey,
      summary: s.summary,
      status: s.status,
      statusCategory: s.statusCategory,
      issueType: s.issueType,
      priority: s.priority,
      jiraUpdatedAt: s.updated,
      lastSyncedAt: now,
    })),
    {
      updateOnDuplicate: ['jiraIssueKey', 'projectKey', 'summary', 'status', 'statusCategory', 'issueType', 'priority', 'jiraUpdatedAt', 'lastSyncedAt', 'updatedAt'],
      conflictAttributes: ['userId', 'jiraIssueId'],
    }
  );
  const rows = await Ticket.findAll({ where: { userId, jiraIssueId: summaries.map((s) => s.id) } });
  return new Map(rows.map((r) => [r.jiraIssueId, r]));
}

async function decorateWithPlanStatus(userId, summaries, rowsByIssueId) {
  const statusMap = await getPlanStatusForTickets(userId, [...rowsByIssueId.values()]);
  return summaries.map((s) => {
    const row = rowsByIssueId.get(s.id);
    return { ...s, ticketId: row?.id || null, plan: row ? statusMap.get(row.id) : { status: 'none' } };
  });
}

async function listAssigned(userId, { filter, q, pageToken, pageSize }) {
  return withJira(userId, async (client, integration) => {
    const jql = buildAssignedJql({ filter, q });
    const [page, total] = await Promise.all([
      client.searchIssues({ jql, fields: LIST_FIELDS, maxResults: pageSize, nextPageToken: pageToken || undefined }),
      // Count is a nicety; never fail the listing because of it.
      client.approximateCount(jql).catch(() => null),
    ]);
    const summaries = (page.issues || []).map((i) => normalizeIssueSummary(i, integration.siteUrl));
    const rows = await cacheTickets(userId, summaries);
    return {
      tickets: await decorateWithPlanStatus(userId, summaries, rows),
      nextPageToken: page.nextPageToken || null,
      isLast: page.isLast ?? !page.nextPageToken,
      total,
      jql,
    };
  });
}

/** Full re-sync of all assigned tickets (bounded) into the local cache. */
async function refreshAssigned(userId, { limit = 500 } = {}) {
  return withJira(userId, async (client, integration) => {
    const jql = buildAssignedJql({ filter: 'all' });
    const syncStartedAt = new Date();
    let token;
    let synced = 0;
    do {
      const page = await client.searchIssues({ jql, fields: LIST_FIELDS, maxResults: 100, nextPageToken: token });
      const summaries = (page.issues || []).map((i) => normalizeIssueSummary(i, integration.siteUrl));
      await cacheTickets(userId, summaries);
      synced += summaries.length;
      token = page.isLast ? null : page.nextPageToken;
    } while (token && synced < limit);
    // Tickets not touched by this full sync are no longer assigned to the user.
    await integration.update({ lastTicketSyncAt: syncStartedAt });
    return { synced, syncedAt: syncStartedAt.toISOString(), truncated: Boolean(token) };
  });
}

/** Fetches a single issue live from Jira, caches it, and returns full detail + plan status. */
async function getTicket(userId, key) {
  return withJira(userId, async (client, integration) => {
    const raw = await client.getIssue(key);
    const detail = normalizeIssueDetail(raw, integration.siteUrl);
    const rows = await cacheTickets(userId, [detail]);
    const [decorated] = await decorateWithPlanStatus(userId, [detail], rows);
    return { ...detail, ...decorated };
  });
}

module.exports = {
  connect,
  status,
  test,
  disconnect,
  getClient,
  withJira,
  listAssigned,
  refreshAssigned,
  getTicket,
  cacheTickets,
  setClientFactory,
  tokenContext,
};

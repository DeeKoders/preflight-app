'use strict';

const { Op } = require('sequelize');
const { DevelopmentPlan, PlanningJob, Ticket, GitHubIntegration } = require('../../db');
const { AppError, notFound, conflict, badRequest } = require('../../lib/errors');
const logger = require('../../lib/logger');
const jiraService = require('../jira/jira.service');
const githubService = require('../github/github.service');
const aiService = require('../ai/ai.service');
const { computeContextHash } = require('../agent/context');
const { normalizeIssueDetail, normalizeComment } = require('../jira/jira.normalize');
const { enqueuePlanningJob } = require('../jobs/queue');
const { serializeJob } = require('../jobs/jobs.service');
const { isStale } = require('./planStatus');

function serializePlan(plan, { ticket, includeContent = false } = {}) {
  const t = ticket || plan.ticket;
  const out = {
    id: plan.id,
    ticketId: plan.ticketId,
    version: plan.version,
    status: plan.generationStatus,
    aiProvider: plan.aiProvider,
    aiModel: plan.aiModel,
    repository: plan.repository,
    tokenUsage: plan.tokenUsage,
    generationDurationMs: plan.generationDurationMs,
    sourceJiraUpdatedAt: plan.sourceJiraUpdatedAt,
    sourceContextHash: plan.sourceContextHash,
    errorDetails: plan.errorDetails,
    createdAt: plan.createdAt,
    ticket: t
      ? {
          id: t.id,
          key: t.jiraIssueKey,
          summary: t.summary,
          status: t.status,
          statusCategory: t.statusCategory,
          issueType: t.issueType,
          priority: t.priority,
          jiraUpdatedAt: t.jiraUpdatedAt,
          lastSyncedAt: t.lastSyncedAt,
        }
      : null,
    isStale: t ? isStale(plan, t.jiraUpdatedAt) : false,
  };
  if (includeContent) {
    out.markdown = plan.markdownContent;
    out.structured = plan.structuredContent;
    out.agentTrace = plan.agentTrace;
  }
  return out;
}

async function findOwnedPlan(userId, id) {
  const plan = await DevelopmentPlan.findOne({ where: { id, userId }, include: [{ model: Ticket, as: 'ticket' }] });
  if (!plan) throw notFound('Development plan');
  return plan;
}

async function siteUrlFor(userId) {
  const status = await jiraService.status(userId);
  return status.connected ? status.siteUrl : null;
}

/**
 * Starts a planning run for a Jira issue. Validates every precondition up
 * front (AI provider, Jira access, repository selection) so the user gets an
 * immediate, actionable error rather than a failed background job.
 */
async function startPlanning(userId, { issueKey, aiSettingId, repository }) {
  const { setting } = await aiService.resolveForPlanning(userId, aiSettingId);
  const ticket = await jiraService.getTicket(userId, issueKey); // verifies the user can read the issue

  let repo = null;
  if (repository === undefined) {
    const gh = await GitHubIntegration.findOne({ where: { userId } });
    repo = gh?.status === 'connected' ? gh.defaultRepository : null;
  } else if (repository) {
    await githubService.assertSelectedRepository(userId, repository);
    repo = repository;
  }

  const active = await PlanningJob.findOne({ where: { userId, ticketId: ticket.ticketId, status: { [Op.in]: PlanningJob.ACTIVE_STATUSES } } });
  if (active) throw conflict('A plan is already being generated for this ticket', { jobId: active.id });

  let job;
  try {
    job = await PlanningJob.create({
      userId,
      ticketId: ticket.ticketId,
      status: 'queued',
      progressMetadata: {},
      options: { aiSettingId: setting.id, provider: setting.provider, model: setting.model, repository: repo },
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      const existing = await PlanningJob.findOne({ where: { userId, ticketId: ticket.ticketId, status: { [Op.in]: PlanningJob.ACTIVE_STATUSES } } });
      throw conflict('A plan is already being generated for this ticket', { jobId: existing?.id });
    }
    throw err;
  }

  try {
    await enqueuePlanningJob(job.id);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to enqueue planning job');
    await job.update({ status: 'failed', errorMessage: 'The job queue is unavailable. Check that Redis is running.', completedAt: new Date() });
    throw new AppError(503, 'QUEUE_UNAVAILABLE', 'The job queue is unavailable. Please try again shortly.');
  }
  const fresh = await PlanningJob.findByPk(job.id, { include: [{ model: Ticket, as: 'ticket' }] });
  return serializeJob(fresh);
}

/** Latest completed version per ticket, plus counts. */
async function listPlans(userId, { q, freshness, provider, page = 1, pageSize = 20 }) {
  const rows = await DevelopmentPlan.findAll({
    where: { userId },
    attributes: { exclude: ['markdownContent', 'structuredContent', 'agentTrace'] },
    include: [{ model: Ticket, as: 'ticket' }],
    order: [['createdAt', 'DESC']],
  });
  const byTicket = new Map();
  for (const r of rows) {
    const entry = byTicket.get(r.ticketId) || { latest: null, latestAny: r, versions: 0 };
    entry.versions += 1;
    if (!entry.latest && r.generationStatus === 'completed') entry.latest = r;
    byTicket.set(r.ticketId, entry);
  }
  const activeJobs = await PlanningJob.findAll({ where: { userId, status: { [Op.in]: PlanningJob.ACTIVE_STATUSES } }, attributes: ['id', 'ticketId'] });
  const activeByTicket = new Map(activeJobs.map((j) => [j.ticketId, j.id]));

  let items = [...byTicket.values()]
    .map(({ latest, latestAny, versions }) => {
      const base = serializePlan(latest || latestAny);
      return { ...base, versionCount: versions, hasCompletedVersion: Boolean(latest), activeJobId: activeByTicket.get(base.ticketId) || null };
    });
  const term = (q || '').trim().toLowerCase();
  if (term) items = items.filter((p) => p.ticket.key.toLowerCase().includes(term) || p.ticket.summary.toLowerCase().includes(term));
  if (provider) items = items.filter((p) => p.aiProvider === provider);
  if (freshness === 'stale') items = items.filter((p) => p.isStale);
  if (freshness === 'fresh') items = items.filter((p) => p.status === 'completed' && !p.isStale);
  if (freshness === 'failed') items = items.filter((p) => p.status === 'failed' && !p.hasCompletedVersion);

  const total = items.length;
  const start = (page - 1) * pageSize;
  return { plans: items.slice(start, start + pageSize), total, page, pageSize, siteUrl: await siteUrlFor(userId) };
}

async function getPlan(userId, id) {
  const plan = await findOwnedPlan(userId, id);
  const [versions, activeJob] = await Promise.all([
    DevelopmentPlan.findAll({
      where: { userId, ticketId: plan.ticketId },
      attributes: ['id', 'version', 'generationStatus', 'aiProvider', 'aiModel', 'createdAt', 'sourceJiraUpdatedAt'],
      order: [['version', 'DESC']],
    }),
    PlanningJob.findOne({ where: { userId, ticketId: plan.ticketId, status: { [Op.in]: PlanningJob.ACTIVE_STATUSES } } }),
  ]);
  const latestCompleted = versions.find((v) => v.generationStatus === 'completed');
  return {
    ...serializePlan(plan, { includeContent: true }),
    isLatest: latestCompleted?.id === plan.id,
    latestVersionId: latestCompleted?.id || null,
    versionCount: versions.length,
    activeJobId: activeJob?.id || null,
    jiraUrl: plan.ticket ? `${(await siteUrlFor(userId)) || ''}/browse/${plan.ticket.jiraIssueKey}` : null,
  };
}

async function listVersions(userId, id) {
  const plan = await findOwnedPlan(userId, id);
  const versions = await DevelopmentPlan.findAll({
    where: { userId, ticketId: plan.ticketId },
    attributes: { exclude: ['markdownContent', 'structuredContent', 'agentTrace'] },
    order: [['version', 'DESC']],
  });
  return versions.map((v) => serializePlan(v, { ticket: plan.ticket }));
}

async function getVersion(userId, id, version) {
  const plan = await findOwnedPlan(userId, id);
  const v = await DevelopmentPlan.findOne({ where: { userId, ticketId: plan.ticketId, version } });
  if (!v) throw notFound(`Version ${version}`);
  return serializePlan(v, { ticket: plan.ticket, includeContent: true });
}

async function regenerate(userId, id, { aiSettingId, repository }) {
  const plan = await findOwnedPlan(userId, id);
  return startPlanning(userId, { issueKey: plan.ticket.jiraIssueKey, aiSettingId, repository });
}

async function getDownload(userId, id) {
  const plan = await findOwnedPlan(userId, id);
  if (plan.generationStatus !== 'completed' || !plan.markdownContent) throw badRequest('Only completed plans can be downloaded');
  return { filename: `${plan.ticket.jiraIssueKey}-development-plan-v${plan.version}.md`, content: plan.markdownContent };
}

/**
 * Live freshness check: fetches the issue from Jira, refreshes the cached
 * `updated` timestamp and compares both the timestamp and the context hash.
 */
async function checkFreshness(userId, id) {
  const plan = await findOwnedPlan(userId, id);
  return jiraService.withJira(userId, async (client, integration) => {
    const raw = await client.getIssue(plan.ticket.jiraIssueKey);
    const ticket = normalizeIssueDetail(raw, integration.siteUrl);
    const comments = ((await client.getComments(ticket.key, { maxResults: 50 }).catch(() => ({ comments: [] }))).comments || []).map(normalizeComment);
    await plan.ticket.update({ jiraUpdatedAt: ticket.updated, summary: ticket.summary, status: ticket.status, statusCategory: ticket.statusCategory, priority: ticket.priority, lastSyncedAt: new Date() });
    const hash = computeContextHash(ticket, comments);
    const timestampChanged = isStale(plan, ticket.updated);
    const contentChanged = Boolean(plan.sourceContextHash) && plan.sourceContextHash !== hash;
    return {
      stale: contentChanged || (timestampChanged && !plan.sourceContextHash),
      timestampChanged,
      contentChanged,
      jiraUpdatedAt: ticket.updated,
      planSourceUpdatedAt: plan.sourceJiraUpdatedAt,
      checkedAt: new Date().toISOString(),
    };
  });
}

module.exports = { startPlanning, listPlans, getPlan, listVersions, getVersion, regenerate, getDownload, checkFreshness, serializePlan };

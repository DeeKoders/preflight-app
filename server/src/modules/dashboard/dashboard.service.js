'use strict';

const { Op } = require('sequelize');
const { Ticket, DevelopmentPlan, PlanningJob, AIProviderSetting, GitHubIntegration, JiraIntegration } = require('../../db');
const logger = require('../../lib/logger');
const jiraService = require('../jira/jira.service');
const { getPlanStatusForTickets } = require('../plans/planStatus');
const { serializePlan } = require('../plans/plans.service');

const SYNC_MAX_AGE_MS = 15 * 60_000;

async function getOverview(userId) {
  const [jira, aiDefault, aiCount, github] = await Promise.all([
    JiraIntegration.findOne({ where: { userId } }),
    AIProviderSetting.findOne({ where: { userId, isDefault: true } }),
    AIProviderSetting.count({ where: { userId } }),
    GitHubIntegration.findOne({ where: { userId } }),
  ]);

  let syncError = null;
  let integration = jira;
  if (jira && jira.status === 'connected' && (!jira.lastTicketSyncAt || Date.now() - new Date(jira.lastTicketSyncAt).getTime() > SYNC_MAX_AGE_MS)) {
    try {
      await jiraService.refreshAssigned(userId);
      integration = await JiraIntegration.findOne({ where: { userId } });
    } catch (err) {
      syncError = err.message;
      logger.warn({ userId, code: err.code }, 'Overview ticket sync failed');
    }
  }

  const assignedWhere = { userId };
  if (integration?.lastTicketSyncAt) assignedWhere.lastSyncedAt = { [Op.gte]: integration.lastTicketSyncAt };
  const assigned = integration ? await Ticket.findAll({ where: assignedWhere, order: [['jiraUpdatedAt', 'DESC']] }) : [];
  const statusMap = await getPlanStatusForTickets(userId, assigned);

  const open = assigned.filter((t) => t.statusCategory !== 'done');
  const counts = {
    assigned: assigned.length,
    open: open.length,
    awaitingPlanning: open.filter((t) => ['none', 'failed'].includes(statusMap.get(t.id)?.status)).length,
    withPlans: assigned.filter((t) => ['ready', 'stale'].includes(statusMap.get(t.id)?.status)).length,
    stalePlans: assigned.filter((t) => statusMap.get(t.id)?.status === 'stale').length,
    activeJobs: await PlanningJob.count({ where: { userId, status: { [Op.in]: PlanningJob.ACTIVE_STATUSES } } }),
    totalPlans: await DevelopmentPlan.count({ where: { userId, generationStatus: 'completed' } }),
  };

  const recentPlans = await DevelopmentPlan.findAll({
    where: { userId, generationStatus: 'completed' },
    attributes: { exclude: ['markdownContent', 'structuredContent', 'agentTrace'] },
    include: [{ model: require('../../db').Ticket, as: 'ticket' }],
    order: [['createdAt', 'DESC']],
    limit: 6,
  });

  return {
    integrations: {
      jira: integration ? { connected: true, status: integration.status, siteUrl: integration.siteUrl, displayName: integration.jiraDisplayName } : { connected: false },
      ai: { configured: aiCount > 0, providers: aiCount, default: aiDefault ? { provider: aiDefault.provider, model: aiDefault.model } : null },
      github: github ? { connected: true, status: github.status, defaultRepository: github.defaultRepository } : { connected: false },
    },
    counts,
    lastSyncedAt: integration?.lastTicketSyncAt || null,
    syncError,
    recentPlans: recentPlans.map((p) => serializePlan(p)),
    recentTickets: assigned.slice(0, 8).map((t) => ({
      ticketId: t.id,
      key: t.jiraIssueKey,
      summary: t.summary,
      status: t.status,
      statusCategory: t.statusCategory,
      issueType: t.issueType,
      priority: t.priority,
      updated: t.jiraUpdatedAt,
      url: integration ? `${integration.siteUrl}/browse/${t.jiraIssueKey}` : null,
      plan: statusMap.get(t.id),
    })),
  };
}

module.exports = { getOverview };

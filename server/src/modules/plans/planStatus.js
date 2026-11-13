'use strict';

const { Op } = require('sequelize');
const { DevelopmentPlan, PlanningJob } = require('../../db');

/** A plan is stale when Jira reports a newer update than the snapshot it was generated from. */
function isStale(plan, ticketJiraUpdatedAt) {
  if (!plan || plan.generationStatus !== 'completed' || !ticketJiraUpdatedAt || !plan.sourceJiraUpdatedAt) return false;
  return new Date(ticketJiraUpdatedAt).getTime() > new Date(plan.sourceJiraUpdatedAt).getTime();
}

/**
 * Returns Map<ticketId, { status, latestPlanId, latestVersion, activeJobId, generatedAt }>.
 * status: none | generating | ready | stale | failed
 */
async function getPlanStatusForTickets(userId, tickets) {
  const ids = tickets.map((t) => t.id);
  const result = new Map();
  if (!ids.length) return result;

  const [plans, jobs] = await Promise.all([
    DevelopmentPlan.findAll({
      where: { userId, ticketId: { [Op.in]: ids } },
      attributes: ['id', 'ticketId', 'version', 'generationStatus', 'sourceJiraUpdatedAt', 'createdAt'],
      order: [['version', 'DESC']],
    }),
    PlanningJob.findAll({
      where: { userId, ticketId: { [Op.in]: ids }, status: { [Op.in]: PlanningJob.ACTIVE_STATUSES } },
      attributes: ['id', 'ticketId', 'status'],
    }),
  ]);

  for (const t of tickets) {
    const mine = plans.filter((p) => p.ticketId === t.id);
    const latestCompleted = mine.find((p) => p.generationStatus === 'completed');
    const latest = mine[0];
    const job = jobs.find((j) => j.ticketId === t.id);
    let status = 'none';
    if (job) status = 'generating';
    else if (latestCompleted) status = isStale(latestCompleted, t.jiraUpdatedAt) ? 'stale' : 'ready';
    else if (latest?.generationStatus === 'failed') status = 'failed';
    result.set(t.id, {
      status,
      latestPlanId: latestCompleted?.id || null,
      latestVersion: latestCompleted?.version || null,
      generatedAt: latestCompleted?.createdAt || null,
      activeJobId: job?.id || null,
    });
  }
  return result;
}

module.exports = { getPlanStatusForTickets, isStale };

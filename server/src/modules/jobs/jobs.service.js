'use strict';

const { PlanningJob, Ticket, DevelopmentPlan } = require('../../db');
const { notFound, conflict } = require('../../lib/errors');
const { removeQueuedJob } = require('./queue');

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    progress: job.progressMetadata || {},
    attempts: job.attempts,
    errorMessage: job.errorMessage,
    repository: job.options?.repository || null,
    planId: job.planId,
    planVersion: job.plan?.version ?? null,
    planStatus: job.plan?.generationStatus ?? null,
    ticket: job.ticket ? { id: job.ticket.id, key: job.ticket.jiraIssueKey, summary: job.ticket.summary } : null,
    provider: job.options?.provider || null,
    model: job.options?.model || null,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  };
}

const include = [
  { model: Ticket, as: 'ticket', attributes: ['id', 'jiraIssueKey', 'summary'] },
  { model: DevelopmentPlan, as: 'plan', attributes: ['id', 'version', 'generationStatus'] },
];

async function getJob(userId, id) {
  const job = await PlanningJob.findOne({ where: { id, userId }, include });
  if (!job) throw notFound('Planning job');
  return serializeJob(job);
}

async function listJobs(userId, { status, limit = 20 } = {}) {
  const where = { userId };
  if (status === 'active') where.status = PlanningJob.ACTIVE_STATUSES;
  else if (status) where.status = status;
  const jobs = await PlanningJob.findAll({ where, include, order: [['createdAt', 'DESC']], limit });
  return jobs.map(serializeJob);
}

/**
 * Cancels a job. Queued jobs are removed from the queue; running jobs are
 * flagged and the worker aborts cooperatively at its next checkpoint.
 */
async function cancelJob(userId, id) {
  const job = await PlanningJob.findOne({ where: { id, userId } });
  if (!job) throw notFound('Planning job');
  if (!PlanningJob.ACTIVE_STATUSES.includes(job.status)) throw conflict(`Job is already ${job.status}`);
  const removed = await removeQueuedJob(job.id).catch(() => false);
  await job.update({ status: 'cancelled', errorMessage: 'Cancelled by user', completedAt: removed || job.status === 'queued' ? new Date() : job.completedAt });
  if (job.planId && (removed || job.status === 'queued')) {
    await DevelopmentPlan.update(
      { generationStatus: 'failed', errorDetails: { code: 'CANCELLED', message: 'Cancelled by user', at: new Date().toISOString() } },
      { where: { id: job.planId, generationStatus: 'generating' } }
    );
  }
  return getJob(userId, id);
}

module.exports = { getJob, listJobs, cancelJob, serializeJob };

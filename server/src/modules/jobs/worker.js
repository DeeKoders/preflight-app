'use strict';

const { Worker } = require('bullmq');
const { Op } = require('sequelize');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const { PlanningJob, DevelopmentPlan } = require('../../db');
const { QUEUE_NAME, getConnection, getQueueJobState } = require('./queue');
const { processPlanningJob } = require('./planning.processor');

/**
 * Marks DB jobs as failed when their queue entry is gone or finished without
 * the DB being updated (e.g. Redis was flushed, or a crash mid-update), so an
 * interrupted job never looks like it is still running or succeeded.
 */
async function reconcileOrphanedJobs() {
  // Grace period avoids racing with jobs that are being created/enqueued right now.
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const active = await PlanningJob.findAll({ where: { status: { [Op.in]: PlanningJob.ACTIVE_STATUSES }, updatedAt: { [Op.lt]: cutoff } } });
  let fixed = 0;
  for (const job of active) {
    const state = await getQueueJobState(job.id).catch(() => 'unknown');
    if (state === 'unknown') continue;
    if (!state || state === 'failed' || state === 'completed') {
      const message = 'The planning job was interrupted before it finished. Please regenerate the plan.';
      await job.update({ status: 'failed', errorMessage: message, completedAt: new Date() });
      if (job.planId) {
        await DevelopmentPlan.update(
          { generationStatus: 'failed', errorDetails: { code: 'INTERRUPTED', message, at: new Date().toISOString() } },
          { where: { id: job.planId, generationStatus: 'generating' } }
        );
      }
      fixed += 1;
    }
  }
  if (fixed) logger.warn({ fixed }, 'Reconciled interrupted planning jobs');
  return fixed;
}

function startWorker() {
  const worker = new Worker(QUEUE_NAME, processPlanningJob, {
    connection: getConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });
  worker.on('failed', (job, err) => logger.warn({ planningJobId: job?.id, attemptsMade: job?.attemptsMade }, `Planning job failed: ${err.message}`));
  worker.on('error', (err) => logger.error({ err: err.message }, 'Worker error'));
  reconcileOrphanedJobs().catch((err) => logger.error({ err: err.message }, 'Job reconciliation failed'));
  const sweep = setInterval(() => reconcileOrphanedJobs().catch(() => {}), 5 * 60_000);
  sweep.unref();
  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Planning worker started');
  return {
    worker,
    async close() {
      clearInterval(sweep);
      await worker.close();
    },
  };
}

module.exports = { startWorker, reconcileOrphanedJobs };

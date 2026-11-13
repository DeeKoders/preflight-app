'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const env = require('../../config/env');
const logger = require('../../lib/logger');

const QUEUE_NAME = 'planning';
let connection;
let queue;

function getConnection() {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
    connection.on('error', (err) => logger.warn({ err: err.message }, 'Redis connection error'));
  }
  return connection;
}

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  return queue;
}

/** Enqueues a planning job. The BullMQ job id equals the PlanningJob id (idempotent). */
async function enqueuePlanningJob(planningJobId) {
  return getQueue().add(
    'plan-ticket',
    { planningJobId },
    {
      jobId: planningJobId,
      attempts: env.PLANNING_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    }
  );
}

async function getQueueJobState(planningJobId) {
  const job = await getQueue().getJob(planningJobId);
  return job ? job.getState() : null;
}

async function removeQueuedJob(planningJobId) {
  const job = await getQueue().getJob(planningJobId);
  if (!job) return false;
  const state = await job.getState();
  if (['waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) {
    await job.remove();
    return true;
  }
  return false;
}

async function pingRedis() {
  return (await getConnection().ping()) === 'PONG';
}

async function closeQueue() {
  await queue?.close();
  await connection?.quit().catch(() => {});
  queue = undefined;
  connection = undefined;
}

module.exports = { QUEUE_NAME, getConnection, enqueuePlanningJob, getQueueJobState, removeQueuedJob, pingRedis, closeQueue };

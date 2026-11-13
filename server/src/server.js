'use strict';

const env = require('./config/env');
const logger = require('./lib/logger');
const { sequelize } = require('./db');
const { createApp } = require('./app');

async function main() {
  await sequelize.authenticate();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, `${env.APP_NAME} API listening`));

  let worker = null;
  if (env.RUN_WORKER_IN_PROCESS) worker = require('./modules/jobs/worker').startWorker();

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    // Let in-flight jobs finish their current step; BullMQ re-queues anything left as stalled.
    await worker?.close().catch(() => {});
    await require('./modules/jobs/queue').closeQueue().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

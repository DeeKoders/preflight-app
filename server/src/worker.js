'use strict';

// Standalone planning worker process (use when RUN_WORKER_IN_PROCESS=false).
const logger = require('./lib/logger');
const { sequelize } = require('./db');
const { startWorker } = require('./modules/jobs/worker');
const { closeQueue } = require('./modules/jobs/queue');

async function main() {
  await sequelize.authenticate();
  const handle = startWorker();
  const shutdown = async () => {
    await handle.close().catch(() => {});
    await closeQueue().catch(() => {});
    await sequelize.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});

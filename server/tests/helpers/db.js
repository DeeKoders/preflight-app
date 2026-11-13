'use strict';

const db = require('../../src/db');

async function resetDb() {
  await db.sequelize.query(
    'TRUNCATE ai_usage_logs, planning_jobs, development_plans, tickets, ai_provider_settings, github_integrations, jira_integrations, revoked_tokens, users RESTART IDENTITY CASCADE'
  );
}

module.exports = { resetDb, db };

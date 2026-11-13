'use strict';

const { Sequelize } = require('sequelize');
const env = require('../config/env');
const dbConfig = require('../config/database')[env.NODE_ENV];
const logger = require('../lib/logger');

const sequelize = new Sequelize(dbConfig.url, {
  dialect: 'postgres',
  logging: env.LOG_LEVEL === 'trace' ? (sql) => logger.trace({ sql }, 'sql') : false,
  define: { underscored: true, timestamps: true },
  dialectOptions: dbConfig.dialectOptions,
  pool: { max: 10, min: 0, idle: 10000 },
});

const models = {
  User: require('./models/user')(sequelize),
  RevokedToken: require('./models/revokedToken')(sequelize),
  JiraIntegration: require('./models/jiraIntegration')(sequelize),
  GitHubIntegration: require('./models/githubIntegration')(sequelize),
  AIProviderSetting: require('./models/aiProviderSetting')(sequelize),
  Ticket: require('./models/ticket')(sequelize),
  DevelopmentPlan: require('./models/developmentPlan')(sequelize),
  PlanningJob: require('./models/planningJob')(sequelize),
  AIUsageLog: require('./models/aiUsageLog')(sequelize),
};

Object.values(models).forEach((m) => m.associate && m.associate(models));

module.exports = { sequelize, Sequelize, ...models };

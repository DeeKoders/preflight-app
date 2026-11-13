'use strict';

const { DataTypes, Model } = require('sequelize');

const STATUSES = ['generating', 'completed', 'failed'];

/** One row per plan version. Versions are never overwritten. */
module.exports = (sequelize) => {
  class DevelopmentPlan extends Model {
    static associate(m) {
      DevelopmentPlan.belongsTo(m.User, { foreignKey: 'userId' });
      DevelopmentPlan.belongsTo(m.Ticket, { foreignKey: 'ticketId', as: 'ticket' });
    }
  }

  DevelopmentPlan.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      ticketId: { type: DataTypes.UUID, allowNull: false },
      version: { type: DataTypes.INTEGER, allowNull: false },
      markdownContent: { type: DataTypes.TEXT },
      structuredContent: { type: DataTypes.JSONB },
      sourceContextHash: { type: DataTypes.STRING(64) },
      sourceJiraUpdatedAt: { type: DataTypes.DATE },
      aiProvider: { type: DataTypes.STRING(20), allowNull: false },
      aiModel: { type: DataTypes.STRING(120), allowNull: false },
      repository: { type: DataTypes.STRING(200) },
      generationStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'generating', validate: { isIn: [STATUSES] } },
      tokenUsage: { type: DataTypes.JSONB },
      generationDurationMs: { type: DataTypes.INTEGER },
      agentTrace: { type: DataTypes.JSONB },
      errorDetails: { type: DataTypes.JSONB },
    },
    { sequelize, modelName: 'DevelopmentPlan', tableName: 'development_plans' }
  );
  DevelopmentPlan.STATUSES = STATUSES;
  return DevelopmentPlan;
};

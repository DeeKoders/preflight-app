'use strict';

const { DataTypes, Model } = require('sequelize');

const STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];
const ACTIVE_STATUSES = ['queued', 'running'];

module.exports = (sequelize) => {
  class PlanningJob extends Model {
    static associate(m) {
      PlanningJob.belongsTo(m.User, { foreignKey: 'userId' });
      PlanningJob.belongsTo(m.Ticket, { foreignKey: 'ticketId', as: 'ticket' });
      PlanningJob.belongsTo(m.DevelopmentPlan, { foreignKey: 'planId', as: 'plan' });
    }
  }

  PlanningJob.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      ticketId: { type: DataTypes.UUID, allowNull: false },
      planId: { type: DataTypes.UUID },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'queued', validate: { isIn: [STATUSES] } },
      currentStage: { type: DataTypes.STRING(50) },
      progressMetadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      options: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      errorMessage: { type: DataTypes.TEXT },
      startedAt: { type: DataTypes.DATE },
      completedAt: { type: DataTypes.DATE },
    },
    { sequelize, modelName: 'PlanningJob', tableName: 'planning_jobs' }
  );
  PlanningJob.STATUSES = STATUSES;
  PlanningJob.ACTIVE_STATUSES = ACTIVE_STATUSES;
  return PlanningJob;
};

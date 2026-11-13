'use strict';

const { DataTypes, Model } = require('sequelize');

/** Minimal, refreshable cache of the Jira issues assigned to a user. */
module.exports = (sequelize) => {
  class Ticket extends Model {
    static associate(m) {
      Ticket.belongsTo(m.User, { foreignKey: 'userId' });
      Ticket.hasMany(m.DevelopmentPlan, { foreignKey: 'ticketId', as: 'plans', onDelete: 'CASCADE' });
      Ticket.hasMany(m.PlanningJob, { foreignKey: 'ticketId', as: 'jobs', onDelete: 'CASCADE' });
    }
  }

  Ticket.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      jiraIssueId: { type: DataTypes.STRING(32), allowNull: false },
      jiraIssueKey: { type: DataTypes.STRING(64), allowNull: false },
      projectKey: { type: DataTypes.STRING(64) },
      summary: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.STRING(100) },
      statusCategory: { type: DataTypes.STRING(20) },
      issueType: { type: DataTypes.STRING(100) },
      priority: { type: DataTypes.STRING(100) },
      jiraUpdatedAt: { type: DataTypes.DATE },
      lastSyncedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { sequelize, modelName: 'Ticket', tableName: 'tickets' }
  );
  return Ticket;
};

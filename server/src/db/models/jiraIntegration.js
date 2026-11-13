'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class JiraIntegration extends Model {
    static associate(m) {
      JiraIntegration.belongsTo(m.User, { foreignKey: 'userId' });
    }

    /** Public, non-sensitive representation. Never includes the token. */
    toSafeJSON() {
      return {
        connected: true,
        siteUrl: this.siteUrl,
        accountEmail: this.accountEmail,
        tokenMask: this.tokenMask,
        jiraAccountId: this.jiraAccountId,
        jiraDisplayName: this.jiraDisplayName,
        status: this.status,
        lastError: this.lastError,
        connectedAt: this.connectedAt,
        lastValidatedAt: this.lastValidatedAt,
        lastTicketSyncAt: this.lastTicketSyncAt,
      };
    }
  }

  JiraIntegration.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false, unique: true },
      siteUrl: { type: DataTypes.STRING(255), allowNull: false },
      accountEmail: { type: DataTypes.STRING(254), allowNull: false },
      encryptedApiToken: { type: DataTypes.TEXT, allowNull: false },
      tokenMask: { type: DataTypes.STRING(32), allowNull: false },
      jiraAccountId: { type: DataTypes.STRING(128) },
      jiraDisplayName: { type: DataTypes.STRING(255) },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'connected', validate: { isIn: [['connected', 'invalid']] } },
      lastError: { type: DataTypes.TEXT },
      connectedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      lastValidatedAt: { type: DataTypes.DATE },
      lastTicketSyncAt: { type: DataTypes.DATE },
    },
    { sequelize, modelName: 'JiraIntegration', tableName: 'jira_integrations' }
  );
  return JiraIntegration;
};

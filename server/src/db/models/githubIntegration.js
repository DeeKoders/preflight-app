'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class GitHubIntegration extends Model {
    static associate(m) {
      GitHubIntegration.belongsTo(m.User, { foreignKey: 'userId' });
    }

    toSafeJSON() {
      return {
        connected: true,
        githubUsername: this.githubUsername,
        tokenMask: this.tokenMask,
        selectedRepositories: this.selectedRepositories || [],
        defaultRepository: this.defaultRepository,
        status: this.status,
        lastError: this.lastError,
        connectedAt: this.connectedAt,
        lastValidatedAt: this.lastValidatedAt,
      };
    }
  }

  GitHubIntegration.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false, unique: true },
      encryptedAccessToken: { type: DataTypes.TEXT, allowNull: false },
      tokenMask: { type: DataTypes.STRING(32), allowNull: false },
      githubUsername: { type: DataTypes.STRING(100) },
      selectedRepositories: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      defaultRepository: { type: DataTypes.STRING(200) },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'connected', validate: { isIn: [['connected', 'invalid']] } },
      lastError: { type: DataTypes.TEXT },
      connectedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      lastValidatedAt: { type: DataTypes.DATE },
    },
    { sequelize, modelName: 'GitHubIntegration', tableName: 'github_integrations' }
  );
  return GitHubIntegration;
};

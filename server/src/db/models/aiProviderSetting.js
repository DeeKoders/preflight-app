'use strict';

const { DataTypes, Model } = require('sequelize');

const PROVIDERS = ['anthropic', 'openai', 'gemini'];

module.exports = (sequelize) => {
  class AIProviderSetting extends Model {
    static associate(m) {
      AIProviderSetting.belongsTo(m.User, { foreignKey: 'userId' });
    }

    toSafeJSON() {
      return {
        id: this.id,
        provider: this.provider,
        model: this.model,
        keyMask: this.keyMask,
        isDefault: this.isDefault,
        validationStatus: this.validationStatus,
        lastValidatedAt: this.lastValidatedAt,
        lastError: this.lastError,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      };
    }
  }

  AIProviderSetting.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      provider: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [PROVIDERS] } },
      model: { type: DataTypes.STRING(120), allowNull: false },
      encryptedApiKey: { type: DataTypes.TEXT, allowNull: false },
      keyMask: { type: DataTypes.STRING(32), allowNull: false },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      validationStatus: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'untested',
        validate: { isIn: [['untested', 'valid', 'invalid']] },
      },
      lastValidatedAt: { type: DataTypes.DATE },
      lastError: { type: DataTypes.TEXT },
    },
    { sequelize, modelName: 'AIProviderSetting', tableName: 'ai_provider_settings' }
  );
  AIProviderSetting.PROVIDERS = PROVIDERS;
  return AIProviderSetting;
};

'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class AIUsageLog extends Model {
    static associate(m) {
      AIUsageLog.belongsTo(m.User, { foreignKey: 'userId' });
      AIUsageLog.belongsTo(m.Ticket, { foreignKey: 'ticketId', as: 'ticket' });
    }
  }

  AIUsageLog.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      userId: { type: DataTypes.UUID, allowNull: false },
      provider: { type: DataTypes.STRING(20), allowNull: false },
      model: { type: DataTypes.STRING(120), allowNull: false },
      ticketId: { type: DataTypes.UUID },
      planningJobId: { type: DataTypes.UUID },
      operation: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'agent_turn' },
      inputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      outputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // null = cost could not be determined (unknown model pricing). Never guessed.
      estimatedCost: {
        type: DataTypes.DECIMAL(12, 6),
        get() {
          const v = this.getDataValue('estimatedCost');
          return v === null || v === undefined ? null : Number(v);
        },
      },
    },
    { sequelize, modelName: 'AIUsageLog', tableName: 'ai_usage_logs', updatedAt: false }
  );
  return AIUsageLog;
};

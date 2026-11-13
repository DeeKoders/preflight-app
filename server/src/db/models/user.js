'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class User extends Model {
    static associate(m) {
      User.hasOne(m.JiraIntegration, { foreignKey: 'userId', onDelete: 'CASCADE' });
      User.hasOne(m.GitHubIntegration, { foreignKey: 'userId', onDelete: 'CASCADE' });
      User.hasMany(m.AIProviderSetting, { foreignKey: 'userId', onDelete: 'CASCADE' });
      User.hasMany(m.Ticket, { foreignKey: 'userId', onDelete: 'CASCADE' });
      User.hasMany(m.DevelopmentPlan, { foreignKey: 'userId', onDelete: 'CASCADE' });
      User.hasMany(m.PlanningJob, { foreignKey: 'userId', onDelete: 'CASCADE' });
    }

    toSafeJSON() {
      return { id: this.id, name: this.name, email: this.email, createdAt: this.createdAt };
    }
  }

  User.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(120), allowNull: false },
      email: {
        type: DataTypes.STRING(254),
        allowNull: false,
        set(v) {
          this.setDataValue('email', String(v).trim().toLowerCase());
        },
      },
      passwordHash: { type: DataTypes.STRING(100), allowNull: false },
    },
    { sequelize, modelName: 'User', tableName: 'users' }
  );
  return User;
};

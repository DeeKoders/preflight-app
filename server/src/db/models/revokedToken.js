'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class RevokedToken extends Model {}
  RevokedToken.init(
    {
      jti: { type: DataTypes.STRING(64), primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, modelName: 'RevokedToken', tableName: 'revoked_tokens', updatedAt: false }
  );
  return RevokedToken;
};

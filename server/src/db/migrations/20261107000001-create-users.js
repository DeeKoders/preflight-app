'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      name: { type: Sequelize.STRING(120), allowNull: false },
      email: { type: Sequelize.STRING(254), allowNull: false },
      password_hash: { type: Sequelize.STRING(100), allowNull: false },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    // Emails are stored lower-cased by the application; this index enforces uniqueness regardless.
    await queryInterface.sequelize.query('CREATE UNIQUE INDEX users_email_lower_unique ON users (LOWER(email))');

    await queryInterface.createTable('revoked_tokens', {
      jti: { type: Sequelize.STRING(64), primaryKey: true },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('revoked_tokens', ['expires_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('revoked_tokens');
    await queryInterface.dropTable('users');
  },
};

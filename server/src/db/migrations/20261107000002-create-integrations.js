'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const userFk = {
      type: Sequelize.UUID,
      allowNull: false,
      unique: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    };

    await queryInterface.createTable('jira_integrations', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: userFk,
      site_url: { type: Sequelize.STRING(255), allowNull: false },
      account_email: { type: Sequelize.STRING(254), allowNull: false },
      encrypted_api_token: { type: Sequelize.TEXT, allowNull: false },
      token_mask: { type: Sequelize.STRING(32), allowNull: false },
      jira_account_id: { type: Sequelize.STRING(128), allowNull: true },
      jira_display_name: { type: Sequelize.STRING(255), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'connected' },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      connected_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      last_validated_at: { type: Sequelize.DATE, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    await queryInterface.createTable('github_integrations', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: userFk,
      encrypted_access_token: { type: Sequelize.TEXT, allowNull: false },
      token_mask: { type: Sequelize.STRING(32), allowNull: false },
      github_username: { type: Sequelize.STRING(100), allowNull: true },
      selected_repositories: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      default_repository: { type: Sequelize.STRING(200), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'connected' },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      connected_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      last_validated_at: { type: Sequelize.DATE, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    await queryInterface.createTable('ai_provider_settings', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      provider: { type: Sequelize.STRING(20), allowNull: false },
      model: { type: Sequelize.STRING(120), allowNull: false },
      encrypted_api_key: { type: Sequelize.TEXT, allowNull: false },
      key_mask: { type: Sequelize.STRING(32), allowNull: false },
      is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      validation_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'untested' },
      last_validated_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('ai_provider_settings', ['user_id', 'provider'], {
      unique: true,
      name: 'ai_provider_settings_user_provider_unique',
    });
    await queryInterface.addIndex('ai_provider_settings', ['user_id'], {
      unique: true,
      where: { is_default: true },
      name: 'ai_provider_settings_one_default_per_user',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_provider_settings');
    await queryInterface.dropTable('github_integrations');
    await queryInterface.dropTable('jira_integrations');
  },
};

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const userFk = { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' };

    await queryInterface.createTable('tickets', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: userFk,
      jira_issue_id: { type: Sequelize.STRING(32), allowNull: false },
      jira_issue_key: { type: Sequelize.STRING(64), allowNull: false },
      project_key: { type: Sequelize.STRING(64), allowNull: true },
      summary: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING(100), allowNull: true },
      status_category: { type: Sequelize.STRING(20), allowNull: true },
      issue_type: { type: Sequelize.STRING(100), allowNull: true },
      priority: { type: Sequelize.STRING(100), allowNull: true },
      jira_updated_at: { type: Sequelize.DATE, allowNull: true },
      last_synced_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('tickets', ['user_id', 'jira_issue_id'], { unique: true, name: 'tickets_user_issue_unique' });
    await queryInterface.addIndex('tickets', ['user_id', 'jira_issue_key'], { name: 'tickets_user_key_idx' });

    await queryInterface.createTable('development_plans', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: userFk,
      ticket_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tickets', key: 'id' }, onDelete: 'CASCADE' },
      version: { type: Sequelize.INTEGER, allowNull: false },
      markdown_content: { type: Sequelize.TEXT, allowNull: true },
      structured_content: { type: Sequelize.JSONB, allowNull: true },
      source_context_hash: { type: Sequelize.STRING(64), allowNull: true },
      source_jira_updated_at: { type: Sequelize.DATE, allowNull: true },
      ai_provider: { type: Sequelize.STRING(20), allowNull: false },
      ai_model: { type: Sequelize.STRING(120), allowNull: false },
      repository: { type: Sequelize.STRING(200), allowNull: true },
      generation_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'generating' },
      token_usage: { type: Sequelize.JSONB, allowNull: true },
      generation_duration_ms: { type: Sequelize.INTEGER, allowNull: true },
      agent_trace: { type: Sequelize.JSONB, allowNull: true },
      error_details: { type: Sequelize.JSONB, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('development_plans', ['ticket_id', 'version'], { unique: true, name: 'development_plans_ticket_version_unique' });
    await queryInterface.addIndex('development_plans', ['user_id', 'created_at'], { name: 'development_plans_user_created_idx' });

    await queryInterface.createTable('planning_jobs', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: userFk,
      ticket_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tickets', key: 'id' }, onDelete: 'CASCADE' },
      plan_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'development_plans', key: 'id' }, onDelete: 'SET NULL' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'queued' },
      current_stage: { type: Sequelize.STRING(50), allowNull: true },
      progress_metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      options: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      error_message: { type: Sequelize.TEXT, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('planning_jobs', ['user_id', 'created_at'], { name: 'planning_jobs_user_created_idx' });
    // Duplicate-request protection: at most one active job per user + ticket.
    await queryInterface.addIndex('planning_jobs', ['user_id', 'ticket_id'], {
      unique: true,
      where: { status: ['queued', 'running'] },
      name: 'planning_jobs_one_active_per_ticket',
    });

    await queryInterface.createTable('ai_usage_logs', {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      user_id: userFk,
      provider: { type: Sequelize.STRING(20), allowNull: false },
      model: { type: Sequelize.STRING(120), allowNull: false },
      ticket_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'tickets', key: 'id' }, onDelete: 'SET NULL' },
      planning_job_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'planning_jobs', key: 'id' }, onDelete: 'SET NULL' },
      operation: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'agent_turn' },
      input_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      output_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      estimated_cost: { type: Sequelize.DECIMAL(12, 6), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('ai_usage_logs', ['user_id', 'created_at'], { name: 'ai_usage_logs_user_created_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_usage_logs');
    await queryInterface.dropTable('planning_jobs');
    await queryInterface.dropTable('development_plans');
    await queryInterface.dropTable('tickets');
  },
};

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('jira_integrations', 'last_ticket_sync_at', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('jira_integrations', 'last_ticket_sync_at');
  },
};

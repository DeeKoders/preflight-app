'use strict';

const bcrypt = require('bcryptjs');

// Development-only seed: creates a demo login. It deliberately does NOT create
// fake Jira/AI integrations — connect real ones from the Integrations page.
module.exports = {
  async up(queryInterface) {
    if (process.env.NODE_ENV === 'production') return;
    const [existing] = await queryInterface.sequelize.query("SELECT id FROM users WHERE email = 'demo@preflight.local'");
    if (existing.length) return;
    await queryInterface.bulkInsert('users', [
      {
        name: 'Demo Developer',
        email: 'demo@preflight.local',
        password_hash: await bcrypt.hash('Preflight!2026', 12),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: 'demo@preflight.local' });
  },
};

'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');

module.exports = async () => {
  // Ensure the test database schema is current before any suite runs.
  execSync('npx sequelize-cli db:migrate', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
};

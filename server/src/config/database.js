'use strict';

/**
 * Database configuration for the app and sequelize-cli (migrations / seeders).
 * Deliberately reads only database settings, so migrations work before app
 * secrets (JWT_SECRET, ENCRYPTION_KEY) are configured.
 */
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const DEFAULT_URL = 'postgres://preflight:preflight@localhost:5433/preflight';
const DEFAULT_TEST_URL = 'postgres://preflight:preflight@localhost:5433/preflight_test';
const ssl = /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL || '');

const base = (url) => ({
  url,
  dialect: 'postgres',
  logging: false,
  define: { underscored: true },
  dialectOptions: ssl ? { ssl: { require: true, rejectUnauthorized: true } } : {},
  migrationStorageTableName: 'sequelize_meta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'sequelize_data',
});

module.exports = {
  development: base(process.env.DATABASE_URL || DEFAULT_URL),
  test: base(process.env.TEST_DATABASE_URL || DEFAULT_TEST_URL),
  production: base(process.env.DATABASE_URL || DEFAULT_URL),
};

'use strict';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  maxWorkers: 1, // integration tests share one test database
  testTimeout: 20000,
  collectCoverageFrom: ['src/**/*.js', '!src/docs/**', '!src/db/migrations/**', '!src/db/seeders/**', '!src/server.js', '!src/worker.js'],
};

'use strict';

const pino = require('pino');
const env = require('../config/env');

// Paths that must never reach logs. pino replaces them with "[REDACTED]".
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.apiKey',
  '*.api_key',
  '*.apiToken',
  '*.api_token',
  '*.accessToken',
  '*.access_token',
  '*.token',
  '*.encryptedApiKey',
  '*.encrypted_api_key',
  '*.encryptedApiToken',
  '*.encrypted_api_token',
  '*.encryptedAccessToken',
  '*.encrypted_access_token',
];

const logger = pino({
  name: 'preflight',
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    env.NODE_ENV === 'development' && process.stdout.isTTY
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,env' } }
      : undefined,
});

module.exports = logger;
module.exports.REDACT_PATHS = REDACT_PATHS;

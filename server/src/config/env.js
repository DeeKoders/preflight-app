'use strict';

const path = require('node:path');
const { z } = require('zod');

// Load the repo-root .env first, then an optional server/.env override.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const bool = (def) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === true || /^(1|true|yes|on)$/i.test(String(v))));

const int = (def) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('Preflight'),
  PORT: z.coerce.number().int().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().default('postgres://preflight:preflight@localhost:5433/preflight'),
  TEST_DATABASE_URL: z.string().default('postgres://preflight:preflight@localhost:5433/preflight_test'),
  DATABASE_SSL: bool(false),

  REDIS_URL: z.string().default('redis://localhost:6380'),
  RUN_WORKER_IN_PROCESS: bool(true),
  WORKER_CONCURRENCY: int(2),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (32 bytes, base64 or hex)'),
  COOKIE_SECURE: bool(false),

  JIRA_ALLOWED_HOST_SUFFIXES: z.string().default('.atlassian.net,.jira.com'),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),

  AGENT_MAX_ITERATIONS: int(14),
  AGENT_MAX_TOOL_CALLS: int(30),
  AGENT_TIMEOUT_MS: int(600000),
  AGENT_MAX_TOTAL_TOKENS: int(800000),
  AGENT_MAX_OUTPUT_TOKENS: int(16000),
  AGENT_MAX_PLAN_REPAIRS: z.coerce.number().int().min(0).default(2),
  PLANNING_JOB_ATTEMPTS: int(3),
});

function loadEnv(source = process.env) {
  const input = { ...source };
  if (input.NODE_ENV === 'test') {
    // Tests never need real secrets; provide deterministic throwaway values.
    input.JWT_SECRET ||= 'test-jwt-secret-that-is-definitely-long-enough';
    input.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
    input.LOG_LEVEL ||= 'silent';
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example for reference.`);
  }
  const env = parsed.data;
  env.isProd = env.NODE_ENV === 'production';
  env.isTest = env.NODE_ENV === 'test';
  env.clientOrigins = env.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  env.jiraAllowedHostSuffixes = env.JIRA_ALLOWED_HOST_SUFFIXES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  env.databaseUrl = env.isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  if (env.isProd && /change-me/i.test(env.JWT_SECRET)) {
    throw new Error('JWT_SECRET still has the example value. Generate a strong secret for production.');
  }
  return env;
}

module.exports = loadEnv();
module.exports.loadEnv = loadEnv;

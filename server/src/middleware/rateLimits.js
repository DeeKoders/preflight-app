'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');

const handler = (_req, res, _next, options) =>
  res.status(options.statusCode).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' } });

const make = (opts) =>
  rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler,
    skip: () => env.isTest && !process.env.ENABLE_RATE_LIMIT_IN_TESTS,
    ...opts,
  });

// Keyed per authenticated user where possible so users behind a shared NAT don't collide.
const userKey = (req) => (req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`);

module.exports = {
  apiLimiter: make({ windowMs: 60_000, limit: 300 }),
  authLimiter: make({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true }),
  credentialTestLimiter: make({ windowMs: 60_000, limit: 15, keyGenerator: userKey }),
  planningLimiter: make({ windowMs: 60 * 60_000, limit: 30, keyGenerator: userKey }),
};

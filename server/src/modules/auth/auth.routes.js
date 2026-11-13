'use strict';

const express = require('express');
const env = require('../../config/env');
const { validate } = require('../../middleware/validate');
const { requireAuth, COOKIE_NAME } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/rateLimits');
const service = require('./auth.service');
const { registerSchema, loginSchema } = require('./auth.schemas');

const router = express.Router();

const cookieOptions = (expiresAt) => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api',
  expires: expiresAt,
});

function sendSession(res, status, { user, token, expiresAt }) {
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
  // The token is also returned for non-browser API clients (Bearer auth).
  res.status(status).json({ data: { user: user.toSafeJSON(), token, expiresAt } });
}

router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  sendSession(res, 201, await service.register(req.valid.body));
});

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  sendSession(res, 200, await service.login(req.valid.body));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ data: { user: req.user.toSafeJSON() } });
});

router.post('/logout', requireAuth, async (req, res) => {
  await service.logout(req.session);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), expires: undefined });
  res.status(204).end();
});

module.exports = router;

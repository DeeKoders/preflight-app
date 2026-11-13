'use strict';

const { unauthorized } = require('../lib/errors');
const authService = require('../modules/auth/auth.service');

const COOKIE_NAME = 'pf_session';

function extractToken(req) {
  const header = req.get('authorization');
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  return req.cookies?.[COOKIE_NAME] || null;
}

/**
 * Requires a valid, non-revoked JWT. The authenticated user is derived only
 * from the server-verified token — client-supplied user IDs are never trusted.
 */
async function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(unauthorized());
  const session = await authService.verifySession(token);
  if (!session) return next(unauthorized('Your session has expired. Please sign in again.'));
  req.user = session.user;
  req.session = session.claims;
  return next();
}

module.exports = { requireAuth, extractToken, COOKIE_NAME };

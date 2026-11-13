'use strict';

const { AppError } = require('../lib/errors');
const logger = require('../lib/logger');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  if (err instanceof AppError) {
    if (err.status >= 500) (req.log || logger).warn({ code: err.code, service: err.service }, err.message);
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    if (err.service) body.service = err.service;
    if (err.retryAfterMs) res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
    return res.status(err.status).json({ error: body });
  }
  if (err?.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A conflicting record already exists' } });
  }
  // Unknown errors: log full detail server-side, return a generic message.
  (req.log || logger).error({ err }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
}

module.exports = { errorHandler, notFoundHandler };

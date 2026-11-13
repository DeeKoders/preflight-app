'use strict';

/**
 * Application error with an HTTP status, a stable machine-readable code and
 * a message that is always safe to show to the end user.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
    this.expose = true;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const validationError = (details) => new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', details);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', message);
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
const preconditionRequired = (code, message) => new AppError(428, code, message);

/**
 * Error raised by an external integration (Jira, GitHub, an AI provider).
 * `retryable` tells the job queue whether a retry with backoff makes sense.
 */
class IntegrationError extends AppError {
  constructor({ service, code, message, status = 502, retryable = false, retryAfterMs, upstreamStatus }) {
    super(status, code, message);
    this.name = 'IntegrationError';
    this.service = service;
    this.retryable = retryable;
    if (retryAfterMs != null) this.retryAfterMs = retryAfterMs;
    if (upstreamStatus) this.upstreamStatus = upstreamStatus;
  }
}

module.exports = {
  AppError,
  IntegrationError,
  badRequest,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  preconditionRequired,
};

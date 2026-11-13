'use strict';

/**
 * Best-effort redaction of credentials that may appear inside retrieved
 * content (repository files, ticket descriptions, comments) before that content
 * is sent to an AI provider or rendered in a plan.
 */
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, '[REDACTED_ANTHROPIC_KEY]'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED_OPENAI_KEY]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bATATT[A-Za-z0-9_\-=]{30,}/g, '[REDACTED_ATLASSIAN_TOKEN]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_SLACK_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [
    /((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']?)([^\s"'`,;]{8,})/gi,
    '$1[REDACTED]',
  ],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/([^:\s/]+):([^@\s]+)@/gi, '$1://$2:[REDACTED]@'],
];

function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  return PATTERNS.reduce((acc, [re, repl]) => acc.replace(re, repl), text);
}

module.exports = { redactSecrets };

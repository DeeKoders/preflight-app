'use strict';

const { redactSecrets } = require('../../lib/redact');

const MAX_TOOL_RESULT_CHARS = 16_000;

/**
 * Wraps external content (Jira, GitHub) in a clearly delimited, untrusted block.
 * Any attempt by the content to close the block early is neutralised so the
 * model can always tell data from instructions.
 */
function wrapUntrusted(source, payload, maxChars = MAX_TOOL_RESULT_CHARS) {
  let body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 1);
  body = redactSecrets(body).replace(/<\/?\s*external_data/gi, '[external_data-tag-removed]');
  let truncated = false;
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n…[truncated ${body.length - maxChars} characters]`;
    truncated = true;
  }
  const safeSource = String(source).replace(/[^A-Za-z0-9:/._ -]/g, '').slice(0, 200);
  return {
    text: `<external_data source="${safeSource}" trust="untrusted">\n${body}\n</external_data>`,
    truncated,
  };
}

module.exports = { wrapUntrusted, MAX_TOOL_RESULT_CHARS };

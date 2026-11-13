'use strict';

const BASE = 'assignee = currentUser()';

const FILTERS = {
  all: null,
  in_progress: 'statusCategory = "In Progress"',
  todo: 'statusCategory = "To Do"',
  done: 'statusCategory = Done',
  recent: 'updated >= -7d',
};

const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}-\d{1,9}$/;

/** Escapes a user-supplied value for use inside a double-quoted JQL string literal. */
function escapeJqlString(value) {
  return String(value)
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .slice(0, 200);
}

/**
 * Builds the "assigned to me" JQL. Only whitelisted filter fragments and
 * escaped literals are ever concatenated — raw user JQL is never accepted.
 */
function buildAssignedJql({ filter = 'all', q } = {}) {
  const clauses = [BASE];
  if (FILTERS[filter]) clauses.push(FILTERS[filter]);
  const term = (q || '').trim();
  if (term) {
    if (ISSUE_KEY_RE.test(term)) clauses.push(`(key = "${escapeJqlString(term.toUpperCase())}" OR summary ~ "${escapeJqlString(term)}")`);
    else clauses.push(`(summary ~ "${escapeJqlString(term)}" OR text ~ "${escapeJqlString(term)}")`);
  }
  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

module.exports = { buildAssignedJql, escapeJqlString, FILTERS, ISSUE_KEY_RE };

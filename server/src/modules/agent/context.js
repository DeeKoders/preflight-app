'use strict';

const { sha256, stableStringify } = require('../../lib/crypto');

/**
 * Hash of the normalised Jira context a plan was generated from. Used together
 * with Jira's `updated` timestamp for freshness detection.
 */
function computeContextHash(ticket, comments = []) {
  const normalized = {
    key: ticket.key,
    summary: ticket.summary,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    issueType: ticket.issueType,
    labels: [...(ticket.labels || [])].sort(),
    components: [...(ticket.components || [])].sort(),
    customFields: (ticket.customFields || []).map((f) => [f.name, f.value]).sort(),
    parent: ticket.parent?.key || null,
    subtasks: (ticket.subtasks || []).map((s) => s.key).sort(),
    links: (ticket.issueLinks || []).map((l) => `${l.relationship}:${l.key}`).sort(),
    attachments: (ticket.attachments || []).map((a) => `${a.id}:${a.size}`).sort(),
    comments: comments.map((c) => `${c.id}:${c.updated || c.created}`).sort(),
  };
  return sha256(stableStringify(normalized));
}

module.exports = { computeContextHash };

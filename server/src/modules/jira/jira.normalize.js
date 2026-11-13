'use strict';

const { adfToMarkdown, fieldToText } = require('./adf');

const STATUS_CATEGORY = { new: 'todo', indeterminate: 'in_progress', done: 'done' };

// Custom fields worth surfacing to the agent, matched by display name.
const RELEVANT_CUSTOM_FIELD_RE =
  /(acceptance criteria|definition of done|story points?|sprint|epic|team|steps to reproduce|expected result|actual result|test (cases|plan)|severity|business value|release notes|technical notes|requirements?)/i;

const person = (p) => (p ? { accountId: p.accountId, displayName: p.displayName } : null);

function normalizeIssueSummary(issue, siteUrl) {
  const f = issue.fields || {};
  return {
    id: issue.id,
    key: issue.key,
    url: `${siteUrl}/browse/${issue.key}`,
    summary: f.summary || '(no summary)',
    status: f.status?.name || null,
    statusCategory: STATUS_CATEGORY[f.status?.statusCategory?.key] || null,
    issueType: f.issuetype?.name || null,
    issueTypeIconUrl: f.issuetype?.iconUrl || null,
    priority: f.priority?.name || null,
    projectKey: f.project?.key || null,
    updated: f.updated || null,
  };
}

function normalizeLink(link) {
  const outward = Boolean(link.outwardIssue);
  const other = link.outwardIssue || link.inwardIssue;
  if (!other) return null;
  return {
    relationship: outward ? link.type?.outward : link.type?.inward,
    type: link.type?.name,
    direction: outward ? 'outward' : 'inward',
    key: other.key,
    summary: other.fields?.summary || null,
    status: other.fields?.status?.name || null,
    issueType: other.fields?.issuetype?.name || null,
  };
}

/** Full ticket detail. `names` maps custom field ids to display names (expand=names). */
function normalizeIssueDetail(issue, siteUrl) {
  const f = issue.fields || {};
  const names = issue.names || {};
  const customFields = Object.entries(f)
    .filter(([id, v]) => id.startsWith('customfield_') && v != null && names[id] && RELEVANT_CUSTOM_FIELD_RE.test(names[id]))
    .map(([id, v]) => ({ id, name: names[id], value: fieldToText(v).slice(0, 8000) }))
    .filter((cf) => cf.value);

  return {
    ...normalizeIssueSummary(issue, siteUrl),
    description: f.description ? adfToMarkdown(f.description) : '',
    environment: f.environment ? adfToMarkdown(f.environment) : '',
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    resolution: f.resolution?.name || null,
    reporter: person(f.reporter),
    assignee: person(f.assignee),
    created: f.created || null,
    dueDate: f.duedate || null,
    project: f.project ? { id: f.project.id, key: f.project.key, name: f.project.name } : null,
    parent: f.parent
      ? {
          key: f.parent.key,
          summary: f.parent.fields?.summary || null,
          status: f.parent.fields?.status?.name || null,
          issueType: f.parent.fields?.issuetype?.name || null,
        }
      : null,
    subtasks: (f.subtasks || []).map((s) => ({
      key: s.key,
      summary: s.fields?.summary || null,
      status: s.fields?.status?.name || null,
      issueType: s.fields?.issuetype?.name || null,
    })),
    issueLinks: (f.issuelinks || []).map(normalizeLink).filter(Boolean),
    attachments: (f.attachment || []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      created: a.created,
      author: a.author?.displayName || null,
    })),
    customFields,
    commentCount: f.comment?.total ?? null,
  };
}

function normalizeComment(c) {
  return {
    id: c.id,
    author: c.author?.displayName || 'Unknown',
    created: c.created,
    updated: c.updated,
    body: adfToMarkdown(c.body),
  };
}

module.exports = { normalizeIssueSummary, normalizeIssueDetail, normalizeComment, STATUS_CATEGORY };

'use strict';

const { z } = require('zod');
const { normalizeIssueDetail, normalizeComment, normalizeIssueSummary } = require('../../jira/jira.normalize');
const { escapeJqlString, ISSUE_KEY_RE } = require('../../jira/jql');

const issueKey = z
  .string()
  .trim()
  .regex(ISSUE_KEY_RE, 'Must be a Jira issue key like ABC-123')
  .transform((k) => k.toUpperCase());
const projectKey = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,30}$/, 'Must be a Jira project key like ABC').transform((k) => k.toUpperCase());

const TEXT_ATTACHMENT_RE = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|x-sh|javascript|sql|graphql))/i;
const TEXT_EXT_RE = /\.(txt|md|markdown|json|ya?ml|csv|log|xml|sql|graphql|feature|har)$/i;
const MAX_ATTACHMENT_BYTES = 200 * 1024;

const SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'updated', 'project', 'labels'];

const jiraTools = [
  {
    name: 'get_ticket_details',
    category: 'jira',
    description:
      'Fetch full details of a Jira issue the user can access: description, labels, components, priority, status, type, parent, subtasks, issue links, attachment metadata and relevant custom fields (e.g. acceptance criteria).',
    input: z.object({ issueKey }),
    async run({ issueKey: key }, ctx) {
      const raw = await ctx.jira.client.getIssue(key);
      const detail = normalizeIssueDetail(raw, ctx.jira.siteUrl);
      ctx.observed.issueKeys.add(detail.key);
      return { source: `jira:${detail.key}`, summary: `Read ${detail.key}: ${detail.summary}`, data: detail };
    },
  },
  {
    name: 'get_ticket_comments',
    category: 'jira',
    description: 'Fetch comments on a Jira issue, newest first. Useful for decisions, clarifications and changed requirements.',
    input: z.object({ issueKey, maxResults: z.number().int().min(1).max(50).default(30) }),
    async run({ issueKey: key, maxResults }, ctx) {
      const data = await ctx.jira.client.getComments(key, { maxResults });
      const comments = (data.comments || []).map(normalizeComment);
      ctx.observed.issueKeys.add(key);
      return {
        source: `jira:${key}/comments`,
        summary: `Read ${comments.length} comment(s) on ${key}`,
        data: { issueKey: key, total: data.total ?? comments.length, comments },
      };
    },
  },
  {
    name: 'get_linked_issues',
    category: 'jira',
    description:
      'Fetch the relationship graph of a Jira issue: issue links (blocks, relates to, duplicates…), parent/epic, subtasks, child issues and remote links (e.g. Confluence pages).',
    input: z.object({ issueKey }),
    async run({ issueKey: key }, ctx) {
      const raw = await ctx.jira.client.getIssue(key, { fields: 'issuelinks,parent,subtasks,summary,status,issuetype', expand: '' });
      const detail = normalizeIssueDetail(raw, ctx.jira.siteUrl);
      const [children, remote] = await Promise.all([
        ctx.jira.client
          .searchIssues({ jql: `parent = "${escapeJqlString(key)}" ORDER BY created ASC`, fields: SEARCH_FIELDS, maxResults: 30 })
          .then((r) => (r.issues || []).map((i) => normalizeIssueSummary(i, ctx.jira.siteUrl)))
          .catch(() => []),
        ctx.jira.client.getRemoteLinks(key).catch(() => []),
      ]);
      const remoteLinks = (Array.isArray(remote) ? remote : [])
        .map((l) => ({ title: l.object?.title || null, url: l.object?.url || null, relationship: l.relationship || null, application: l.application?.name || null }))
        .filter((l) => l.url && /^https:\/\//i.test(l.url));
      remoteLinks.forEach((l) => ctx.observed.urls.add(l.url));
      [detail.parent, ...detail.subtasks, ...detail.issueLinks, ...children].filter(Boolean).forEach((i) => ctx.observed.issueKeys.add(i.key));
      const count = detail.issueLinks.length + detail.subtasks.length + children.length + (detail.parent ? 1 : 0);
      return {
        source: `jira:${key}/links`,
        summary: `Found ${count} related issue(s) and ${remoteLinks.length} remote link(s) for ${key}`,
        data: { issueKey: key, parent: detail.parent, subtasks: detail.subtasks, issueLinks: detail.issueLinks, children, remoteLinks },
      };
    },
  },
  {
    name: 'search_jira_issues',
    category: 'jira',
    description:
      'Search Jira for related issues by free text (e.g. a feature name, component or error message). Optionally restrict to a project. Returns summaries only; use get_ticket_details for depth.',
    input: z.object({
      text: z.string().trim().min(2).max(120),
      projectKey: projectKey.optional(),
      includeDone: z.boolean().default(true),
      maxResults: z.number().int().min(1).max(15).default(10),
    }),
    async run({ text, projectKey: pk, includeDone, maxResults }, ctx) {
      const clauses = [`text ~ "${escapeJqlString(text)}"`];
      if (pk) clauses.push(`project = "${escapeJqlString(pk)}"`);
      if (!includeDone) clauses.push('statusCategory != Done');
      if (ctx.ticketKey) clauses.push(`key != "${escapeJqlString(ctx.ticketKey)}"`);
      const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;
      const res = await ctx.jira.client.searchIssues({ jql, fields: SEARCH_FIELDS, maxResults });
      const issues = (res.issues || []).map((i) => ({ ...normalizeIssueSummary(i, ctx.jira.siteUrl), labels: i.fields?.labels || [] }));
      issues.forEach((i) => ctx.observed.issueKeys.add(i.key));
      return { source: 'jira:search', summary: `Searched Jira for "${text}" → ${issues.length} result(s)`, data: { query: text, issues } };
    },
  },
  {
    name: 'get_project_details',
    category: 'jira',
    description: 'Fetch Jira project information: name, description, lead, issue types and components (with descriptions).',
    input: z.object({ projectKey }),
    async run({ projectKey: pk }, ctx) {
      const [project, components] = await Promise.all([
        ctx.jira.client.getProject(pk),
        ctx.jira.client.getProjectComponents(pk).catch(() => []),
      ]);
      return {
        source: `jira:project/${pk}`,
        summary: `Read project ${pk} (${project.name})`,
        data: {
          key: project.key,
          name: project.name,
          description: project.description || '',
          lead: project.lead?.displayName || null,
          projectType: project.projectTypeKey || null,
          style: project.style || null,
          issueTypes: (project.issueTypes || []).map((t) => t.name),
          components: (components || []).map((c) => ({ name: c.name, description: c.description || '' })),
        },
      };
    },
  },
  {
    name: 'get_attachment_content',
    category: 'jira',
    description: `Read the text content of a small text-based attachment (txt, md, json, yaml, csv, log, xml; max ${MAX_ATTACHMENT_BYTES / 1024} KB) on a Jira issue. Binary files (images, PDFs, archives) cannot be read.`,
    input: z.object({ issueKey, attachmentId: z.string().trim().regex(/^\d{1,20}$/, 'Attachment id must be numeric') }),
    async run({ issueKey: key, attachmentId }, ctx) {
      // Verify the attachment belongs to the issue (and that the user can see the issue).
      const raw = await ctx.jira.client.getIssue(key, { fields: 'attachment', expand: '' });
      const att = (raw.fields?.attachment || []).find((a) => String(a.id) === attachmentId);
      if (!att) throw new Error(`Attachment ${attachmentId} is not attached to ${key}`);
      if (!(TEXT_ATTACHMENT_RE.test(att.mimeType || '') || TEXT_EXT_RE.test(att.filename || ''))) {
        throw new Error(`Attachment "${att.filename}" (${att.mimeType}) is not a text file and cannot be read safely`);
      }
      if (att.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment "${att.filename}" is too large to read (${att.size} bytes)`);
      const buf = await ctx.jira.client.getAttachmentContent(attachmentId, MAX_ATTACHMENT_BYTES);
      if (buf.includes(0)) throw new Error(`Attachment "${att.filename}" appears to be binary`);
      return {
        source: `jira:${key}/attachment/${att.filename}`,
        summary: `Read attachment "${att.filename}" on ${key}`,
        data: { issueKey: key, filename: att.filename, mimeType: att.mimeType, content: buf.toString('utf8') },
      };
    },
  },
];

module.exports = { jiraTools };

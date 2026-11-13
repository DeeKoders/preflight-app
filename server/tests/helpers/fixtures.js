'use strict';

const SITE = 'https://acme.atlassian.net';

function rawIssue(overrides = {}) {
  const { fields: fieldOverrides, ...rest } = overrides;
  return {
    id: '10001',
    key: 'PROJ-1',
    names: { customfield_10050: 'Acceptance Criteria', customfield_10016: 'Story point estimate' },
    ...rest,
    fields: {
      summary: 'Allow users to export invoices as CSV',
      description: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Finance needs a ' }, { type: 'text', text: 'CSV export', marks: [{ type: 'strong' }] }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Include invoice number and total' }] }] }] },
        ],
      },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story', iconUrl: 'https://acme.atlassian.net/icon.png' },
      priority: { name: 'High' },
      labels: ['billing'],
      components: [{ name: 'Billing' }],
      fixVersions: [],
      project: { id: '1', key: 'PROJ', name: 'Project' },
      updated: '2026-11-01T10:00:00.000+0000',
      created: '2026-10-20T10:00:00.000+0000',
      reporter: { accountId: 'r1', displayName: 'Rita Reporter' },
      assignee: { accountId: 'a1', displayName: 'Dev Eloper' },
      parent: { key: 'PROJ-100', fields: { summary: 'Billing epic', status: { name: 'To Do' }, issuetype: { name: 'Epic' } } },
      subtasks: [],
      issuelinks: [
        { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'PROJ-7', fields: { summary: 'Invoice list page', status: { name: 'Done' }, issuetype: { name: 'Story' } } } },
      ],
      attachment: [{ id: '500', filename: 'sample.csv', mimeType: 'text/csv', size: 120, created: '2026-10-21', author: { displayName: 'Rita' } }],
      customfield_10050: 'Given an invoice list, when I click export, then a CSV downloads',
      comment: { total: 1 },
      ...fieldOverrides,
    },
  };
}

/** Minimal in-memory Jira client implementing the JiraClient surface used by the app. */
function fakeJiraClient({ issue = rawIssue(), comments = [], searchIssues, onGetIssue } = {}) {
  const calls = [];
  const client = {
    siteUrl: SITE,
    calls,
    async getMyself() {
      calls.push('getMyself');
      return { accountId: 'acc-1', displayName: 'Dev Eloper', emailAddress: 'dev@acme.com' };
    },
    async searchIssues(args) {
      calls.push(['searchIssues', args.jql]);
      if (searchIssues) return searchIssues(args);
      return { issues: [issue], isLast: true };
    },
    async approximateCount() {
      return 1;
    },
    async getIssue(key, opts) {
      calls.push(['getIssue', key, opts]);
      if (onGetIssue) return onGetIssue(key, opts);
      if (key !== issue.key) {
        const { IntegrationError } = require('../../src/lib/errors');
        throw new IntegrationError({ service: 'jira', code: 'JIRA_NOT_FOUND', message: 'Not found', status: 404 });
      }
      return issue;
    },
    async getComments(key) {
      calls.push(['getComments', key]);
      return { total: comments.length, comments };
    },
    async getRemoteLinks() {
      return [{ object: { title: 'Spec page', url: 'https://acme.atlassian.net/wiki/spaces/FIN/pages/1' } }];
    },
    async getProject(key) {
      return { key, name: 'Project', description: 'Billing platform', lead: { displayName: 'Lead' }, issueTypes: [{ name: 'Story' }] };
    },
    async getProjectComponents() {
      return [{ name: 'Billing', description: 'Invoices' }];
    },
    async getAttachmentContent() {
      return Buffer.from('invoice,total\n1,10\n');
    },
  };
  return client;
}

function validPlan(overrides = {}) {
  return {
    businessObjective: 'Let finance reconcile invoices faster.',
    userProblem: 'Finance copies invoice data manually.',
    expectedBehavior: 'A CSV export button downloads the filtered invoice list.',
    requirements: {
      functional: [{ description: 'Export the invoice list as CSV', source: 'description' }],
      nonFunctional: [{ description: 'Export of 10k rows completes in under 5s', source: 'inferred' }],
      acceptanceCriteria: [{ criterion: 'Clicking export downloads a CSV', status: 'explicit' }],
      constraints: ['Use existing invoice permissions'],
    },
    gaps: { missingInformation: ['Column order'], ambiguities: ['Which date format?'], conflicts: [], missingAcceptanceCriteria: false },
    existingSystem: {
      codebaseAnalyzed: false,
      summary: 'Codebase not analysed.',
      frontend: [{ statement: 'An invoice list page exists (PROJ-7)', confidence: 'inferred', evidence: 'PROJ-7 link' }],
      backend: [],
      database: [],
      integrations: [],
      relevantCode: [],
    },
    impact: {
      components: [{ statement: 'Invoice list UI', confidence: 'inferred' }],
      services: [],
      api: [{ statement: 'New export endpoint', confidence: 'inferred' }],
      database: [],
      integrations: [],
      regressionAreas: [{ statement: 'Invoice filtering', confidence: 'unknown' }],
    },
    approach: { summary: 'Add a streaming CSV endpoint and an export button.', rationale: 'Streaming keeps memory flat.', alternativesConsidered: ['Client-side CSV'] },
    checklist: {
      preparation: [{ task: 'Confirm columns with finance' }],
      backend: [{ task: 'Add GET /invoices/export', details: 'Stream rows' }],
      frontend: [{ task: 'Add export button' }],
      database: [],
      integrations: [],
      testing: [{ task: 'Add API tests' }],
      finalVerification: [{ task: 'Verify CSV opens in Excel' }],
    },
    qaScenarios: [
      { id: 'QA-01', scenario: 'Export with results', preconditions: 'Invoices exist', steps: ['Open list', 'Click export'], expectedResult: 'CSV | downloads', type: 'positive' },
      { id: 'QA-02', scenario: 'Export empty list', preconditions: 'No invoices', steps: ['Click export'], expectedResult: 'CSV with headers only', type: 'edge_case' },
      { id: 'QA-03', scenario: 'User without permission', preconditions: 'Viewer role', steps: ['Call endpoint'], expectedResult: '403', type: 'permission' },
    ],
    risks: [{ risk: 'Large exports time out', category: 'technical', severity: 'medium', mitigation: 'Stream the response' }],
    dependencies: ['Finance sign-off'],
    assumptions: ['CSV uses UTF-8'],
    clarificationQuestions: [{ question: 'Which columns?', reason: 'Not specified', askWho: 'Product owner' }],
    references: [{ label: 'PROJ-7 Invoice list page', type: 'jira' }],
    evidence: [{ finding: 'Export is required', confidence: 'confirmed', evidence: 'PROJ-1 description' }],
    overallConfidence: 'medium',
    confidenceRationale: 'Requirements are clear but no codebase access.',
    ...overrides,
  };
}

/**
 * Scripted AI adapter: each call to executeAgentTurn returns the next scripted
 * turn (a function receiving the request, or a static object).
 */
function scriptedAdapter(script) {
  const requests = [];
  let i = 0;
  return {
    provider: 'anthropic',
    requests,
    async validateConnection() {
      return { ok: true, models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }] };
    },
    async getAvailableModels() {
      return [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }];
    },
    async generateResponse() {
      return { text: 'OK', usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'end_turn' };
    },
    async executeAgentTurn(req) {
      requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      const out = typeof step === 'function' ? step(req) : step;
      return { text: '', toolCalls: [], stopReason: 'tool_use', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, raw: null, ...out };
    },
  };
}

const call = (name, args, id = `${name}-${Math.random().toString(36).slice(2, 8)}`) => ({ id, name, arguments: args });

module.exports = { SITE, rawIssue, fakeJiraClient, validPlan, scriptedAdapter, call };

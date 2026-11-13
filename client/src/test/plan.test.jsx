import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPage } from '../pages/PlanPage';
import { JobPage } from '../pages/JobPage';
import { splitSections } from '../components/plan/MarkdownDocument';
import { computeDiff } from '../components/plan/VersionDiff';
import { mockApi, renderWithProviders } from './utils';

const MD = `# Development Plan — PROJ-1

> **Export invoices**

## 1. Ticket Overview

| Field | Value |
| --- | --- |
| Ticket key | [PROJ-1](https://acme.atlassian.net/browse/PROJ-1) |

## 7. Implementation Checklist

### Backend

- [ ] Add export endpoint

\`\`\`js
const a = 1;
\`\`\`

[bad](javascript:alert(1))

## 13. Confidence and Evidence

All good.
`;

const plan = (over = {}) => ({
  id: 'p1',
  version: 2,
  versionCount: 2,
  status: 'completed',
  aiProvider: 'anthropic',
  aiModel: 'claude-opus-5-5',
  repository: null,
  isStale: false,
  isLatest: true,
  markdown: MD,
  tokenUsage: { inputTokens: 1000, outputTokens: 500, estimatedCostUsd: null },
  generationDurationMs: 42000,
  createdAt: '2026-11-07T10:00:00Z',
  sourceJiraUpdatedAt: '2026-11-06T10:00:00Z',
  jiraUrl: 'https://acme.atlassian.net/browse/PROJ-1',
  ticket: { key: 'PROJ-1', summary: 'Export invoices', status: 'In Progress', statusCategory: 'in_progress', jiraUpdatedAt: '2026-11-06T10:00:00Z' },
  agentTrace: { stats: { toolCalls: 2, iterations: 3, filesRead: 0, issuesSeen: 2 }, toolCalls: [{ tool: 'get_linked_issues', ok: true, summary: 'Found 1 related issue' }], verificationNotes: [] },
  ...over,
});

const versions = [
  { id: 'p1', version: 2, status: 'completed', aiModel: 'claude-opus-5-5', createdAt: '2026-11-07T10:00:00Z' },
  { id: 'p0', version: 1, status: 'completed', aiModel: 'claude-opus-5-5', createdAt: '2026-11-05T10:00:00Z' },
];

describe('plan viewer', () => {
  it('renders the document with contents, safe links, checkboxes, metadata and download', async () => {
    mockApi({ 'GET /plans/p1': plan(), 'GET /plans/p1/versions': versions });
    renderWithProviders(<PlanPage />, { route: '/plans/p1', path: '/plans/:id' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Development Plan — PROJ-1' })).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: 'Plan contents' });
    expect(toc).toHaveTextContent('Ticket Overview');
    expect(toc).toHaveTextContent('Confidence and Evidence');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Checklist item' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'PROJ-1' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('bad').closest('a')).toBeNull(); // javascript: link neutralised
    expect(screen.getByRole('link', { name: 'Download Markdown file' })).toHaveAttribute('href', '/api/plans/p1/download');
    expect(screen.getByText('Not available')).toBeInTheDocument(); // unknown cost is never invented
    expect(screen.getByText('Version 2 of 2')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Compare/ })).toBeInTheDocument();
  });

  it('collapses sections', async () => {
    mockApi({ 'GET /plans/p1': plan(), 'GET /plans/p1/versions': versions });
    renderWithProviders(<PlanPage />, { route: '/plans/p1', path: '/plans/:id' });
    const toggle = await screen.findByRole('button', { name: 'Collapse 7. Implementation Checklist' });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand 7. Implementation Checklist' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Add export endpoint')).not.toBeVisible();
  });

  it('warns clearly when the plan is stale', async () => {
    mockApi({ 'GET /plans/p1': plan({ isStale: true, ticket: { ...plan().ticket, jiraUpdatedAt: '2026-11-07T12:00:00Z' } }), 'GET /plans/p1/versions': versions });
    renderWithProviders(<PlanPage />, { route: '/plans/p1', path: '/plans/:id' });
    expect(await screen.findByText('The Jira ticket changed after this plan was generated')).toBeInTheDocument();
    expect(screen.getByText('Ticket changed since generation')).toBeInTheDocument();
  });

  it('flags older versions', async () => {
    mockApi({ 'GET /plans/p0': plan({ id: 'p0', version: 1, isLatest: false, latestVersionId: 'p1' }), 'GET /plans/p0/versions': versions });
    renderWithProviders(<PlanPage />, { route: '/plans/p0', path: '/plans/:id' });
    expect(await screen.findByText('You are viewing version 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open latest' })).toHaveAttribute('href', '/plans/p1');
  });
});

describe('planning progress', () => {
  it('shows real stages and agent activity', async () => {
    mockApi({
      'GET /planning-jobs/j1': {
        id: 'j1',
        status: 'running',
        provider: 'openai',
        model: 'gpt-5',
        repository: null,
        ticket: { key: 'PROJ-1', summary: 'Export invoices' },
        progress: {
          stages: [
            { id: 'fetch_ticket', label: 'Fetching Jira ticket', status: 'done', note: 'PROJ-1' },
            { id: 'investigate_jira', label: 'Investigating related issues', status: 'active' },
            { id: 'explore_codebase', label: 'Exploring codebase', status: 'skipped', note: 'Codebase analysis unavailable' },
            { id: 'save_plan', label: 'Saving development plan', status: 'pending' },
          ],
          events: [{ at: '2026-11-07T10:00:00Z', message: 'Read 3 comment(s) on PROJ-1', level: 'info' }],
        },
      },
    });
    renderWithProviders(<JobPage />, { route: '/jobs/j1', path: '/jobs/:id' });
    const stage = (text) => (_, el) => el?.tagName === 'P' && el.textContent === text;
    expect(await screen.findByText(stage('Investigating related issues — active'))).toBeInTheDocument();
    expect(screen.getByText(stage('Fetching Jira ticket — done'))).toBeInTheDocument();
    expect(screen.getByText(stage('Exploring codebase — skipped'))).toBeInTheDocument();
    expect(screen.getByText('Codebase analysis unavailable')).toBeInTheDocument();
    expect(screen.getByText('Read 3 comment(s) on PROJ-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull(); // no fake percentages
  });

  it('shows failures with the reason', async () => {
    mockApi({ 'GET /planning-jobs/j2': { id: 'j2', status: 'failed', errorMessage: 'Anthropic rejected the API key.', ticket: { key: 'PROJ-1' }, progress: { stages: [], events: [] } } });
    renderWithProviders(<JobPage />, { route: '/jobs/j2', path: '/jobs/:id' });
    expect(await screen.findByText('The plan could not be generated')).toBeInTheDocument();
    expect(screen.getByText('Anthropic rejected the API key.')).toBeInTheDocument();
  });
});

describe('plan helpers', () => {
  it('splits sections without breaking on headings inside code fences', () => {
    const { sections } = splitSections('# T\n\n## A\ntext\n```\n## not a heading\n```\n## B\nmore');
    expect(sections.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('computes line diffs between versions', () => {
    const d = computeDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.rows.filter((r) => r.type === 'same').map((r) => r.text)).toEqual(['a', 'c']);
  });
});

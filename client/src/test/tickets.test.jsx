import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TicketsPage } from '../pages/TicketsPage';
import { mockApi, renderWithProviders } from './utils';

const ticket = (over = {}) => ({
  id: '10001',
  key: 'PROJ-1',
  url: 'https://acme.atlassian.net/browse/PROJ-1',
  summary: 'Export invoices as CSV',
  status: 'In Progress',
  statusCategory: 'in_progress',
  issueType: 'Story',
  priority: 'High',
  updated: new Date().toISOString(),
  ticketId: 't1',
  plan: { status: 'none' },
  ...over,
});

describe('My Tickets', () => {
  it('shows the Jira setup state when not connected', async () => {
    mockApi({ 'GET /integrations/jira/status': { connected: false } });
    renderWithProviders(<TicketsPage />);
    expect(await screen.findByText('Connect Jira to see your tickets')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect Jira' })).toHaveAttribute('href', '/integrations');
  });

  it('lists assigned tickets with plan status and actions', async () => {
    mockApi({
      'GET /integrations/jira/status': { connected: true, siteUrl: 'https://acme.atlassian.net' },
      'GET /jira/tickets': {
        tickets: [ticket(), ticket({ id: '10002', key: 'PROJ-2', summary: 'Fix login', plan: { status: 'stale', latestPlanId: 'p2', latestVersion: 3 } })],
        isLast: true,
        nextPageToken: null,
        total: 2,
      },
    });
    renderWithProviders(<TicketsPage />);
    const row1 = (await screen.findByText('Export invoices as CSV')).closest('tr');
    expect(within(row1).getByText('Not planned')).toBeInTheDocument();
    expect(within(row1).getByRole('button', { name: /Plan It/ })).toBeInTheDocument();
    expect(within(row1).getByRole('link', { name: 'Open PROJ-1 in Jira' })).toHaveAttribute('href', 'https://acme.atlassian.net/browse/PROJ-1');
    const row2 = screen.getByText('Fix login').closest('tr');
    expect(within(row2).getByText('Plan outdated')).toBeInTheDocument();
    expect(within(row2).getByRole('link', { name: 'View plan' })).toHaveAttribute('href', '/plans/p2');
  });

  it('applies filters and search to the Jira query', async () => {
    const calls = mockApi({
      'GET /integrations/jira/status': { connected: true, siteUrl: 'https://acme.atlassian.net' },
      'GET /jira/tickets': { tickets: [], isLast: true, total: 0 },
    });
    renderWithProviders(<TicketsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'In progress' }));
    await userEvent.type(screen.getByLabelText('Search tickets'), 'PROJ-9');
    expect(await screen.findByText(/No tickets match/)).toBeInTheDocument();
    const last = calls.filter((c) => c.path === '/jira/tickets').at(-1);
    expect(last.query.get('filter')).toBe('in_progress');
    expect(last.query.get('q')).toBe('PROJ-9');
  });

  it('starts planning from the Plan It dialog with the chosen provider', async () => {
    const calls = mockApi({
      'GET /integrations/jira/status': { connected: true, siteUrl: 'https://acme.atlassian.net' },
      'GET /jira/tickets': { tickets: [ticket()], isLast: true, total: 1 },
      'GET /ai/settings': [{ id: 's1', provider: 'anthropic', model: 'claude-opus-5-5', isDefault: true, validationStatus: 'valid', keyMask: 'sk-ant-••••abcd' }],
      'GET /integrations/github/status': { connected: false },
      'POST /plans': { id: 'job-1', status: 'queued', ticket: { key: 'PROJ-1' } },
    });
    renderWithProviders(<TicketsPage />, { extraRoutes: [['/jobs/:id', <p key="job">Job page</p>]], path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: /Plan It/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Anthropic — claude-opus-5-5 \(default\)/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start planning' }));
    expect(await screen.findByText('Job page')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/plans').body).toEqual({ issueKey: 'PROJ-1', aiSettingId: 's1', repository: null });
  });
});

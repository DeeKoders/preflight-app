import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AISettingsPage } from '../pages/AISettingsPage';
import { JiraCard } from '../pages/IntegrationsPage';
import { apiError, mockApi, renderWithProviders } from './utils';

const providers = [
  { id: 'anthropic', label: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com', keyPrefix: 'sk-ant-', suggestedModels: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }] },
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com', keyPrefix: 'sk-', suggestedModels: [{ id: 'gpt-5', name: 'GPT-5' }] },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com', keyPrefix: 'AIza', suggestedModels: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }] },
];
const usage = { days: 30, totals: { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 }, breakdown: [], recent: [] };

describe('AI settings', () => {
  it('explains BYOK, shows masked keys only and saves a new key', async () => {
    const calls = mockApi({
      'GET /ai/providers': providers,
      'GET /ai/settings': [{ id: 's1', provider: 'anthropic', model: 'claude-opus-5-5', keyMask: 'sk-ant-••••wxyz', isDefault: true, validationStatus: 'valid' }],
      'GET /ai/usage': usage,
      'POST /ai/settings': { id: 's2', provider: 'openai', model: 'gpt-5', keyMask: 'sk-••••1234' },
    });
    renderWithProviders(<AISettingsPage />);
    expect(await screen.findByText(/billed by the provider to your account/)).toBeInTheDocument();
    const anthropic = (await screen.findByRole('heading', { name: 'Anthropic Claude' })).closest('section');
    expect(within(anthropic).getByText('Saved key sk-ant-••••wxyz. Leave empty to keep it.')).toBeInTheDocument();
    expect(within(anthropic).getByText('Default')).toBeInTheDocument();
    expect(within(anthropic).getByLabelText('API key')).toHaveValue('');

    const openai = screen.getByRole('heading', { name: 'OpenAI' }).closest('section');
    expect(within(openai).getByText('Not configured')).toBeInTheDocument();
    await userEvent.type(within(openai).getByLabelText('API key'), 'sk-proj-newkey-1234');
    await userEvent.click(within(openai).getByRole('button', { name: 'Verify and save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/ai/settings')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/ai/settings').body).toEqual({ provider: 'openai', model: 'gpt-5', apiKey: 'sk-proj-newkey-1234', isDefault: false });
  });

  it('surfaces provider validation errors', async () => {
    mockApi({
      'GET /ai/providers': providers,
      'GET /ai/settings': [],
      'GET /ai/usage': usage,
      'POST /ai/settings': apiError(401, 'AI_AUTH_FAILED', 'Google Gemini rejected the API key. Check that it is valid and active.'),
    });
    renderWithProviders(<AISettingsPage />);
    const gemini = (await screen.findByRole('heading', { name: 'Google Gemini' })).closest('section');
    await userEvent.type(within(gemini).getByLabelText('API key'), 'AIza-invalid-key');
    await userEvent.click(within(gemini).getByRole('button', { name: 'Verify and save' }));
    expect(await within(gemini).findByText(/rejected the API key/)).toBeInTheDocument();
  });
});

describe('Jira connection card', () => {
  it('shows connection details without revealing the token and can test it', async () => {
    const calls = mockApi({
      'GET /integrations/jira/status': {
        connected: true,
        siteUrl: 'https://acme.atlassian.net',
        accountEmail: 'dev@acme.com',
        jiraDisplayName: 'Dev Eloper',
        tokenMask: 'ATATT3••••9xYz',
        status: 'connected',
        lastValidatedAt: '2026-11-07T10:00:00Z',
      },
      'POST /integrations/jira/test': { ok: true, account: { displayName: 'Dev Eloper' } },
    });
    renderWithProviders(<JiraCard />);
    expect(await screen.findByText('ATATT3••••9xYz')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/integrations/jira/test')).toBe(true);
  });

  it('shows the connect form and API errors when not connected', async () => {
    mockApi({
      'GET /integrations/jira/status': { connected: false },
      'POST /integrations/jira/connect': apiError(401, 'JIRA_AUTH_FAILED', 'Jira rejected the credentials. The email or API token is invalid, expired or revoked.'),
    });
    renderWithProviders(<JiraCard />);
    await userEvent.type(await screen.findByLabelText('Jira site URL'), 'acme.atlassian.net');
    await userEvent.type(screen.getByLabelText('Atlassian account email'), 'dev@acme.com');
    await userEvent.type(screen.getByLabelText('API token'), 'bad-token-value');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and connect' }));
    expect(await screen.findByText(/Jira rejected the credentials/)).toBeInTheDocument();
  });
});

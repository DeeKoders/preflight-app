import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage, RegisterPage } from '../pages/AuthPages';
import { apiError, mockApi, renderWithProviders } from './utils';

describe('login and registration', () => {
  it('signs in and redirects to the app', async () => {
    const calls = mockApi({
      'GET /auth/me': apiError(401, 'UNAUTHORIZED', 'Authentication required'),
      'POST /auth/login': { user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } },
    });
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login', extraRoutes: [['/', <p key="home">Home page</p>]] });
    await userEvent.type(await screen.findByLabelText('Work email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'CorrectHorse42');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/auth/login').body).toEqual({ email: 'ada@example.com', password: 'CorrectHorse42' });
  });

  it('shows an error for invalid credentials', async () => {
    mockApi({
      'GET /auth/me': apiError(401, 'UNAUTHORIZED', 'Authentication required'),
      'POST /auth/login': apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
    });
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(await screen.findByLabelText('Work email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('maps server validation errors to registration fields', async () => {
    mockApi({
      'GET /auth/me': apiError(401, 'UNAUTHORIZED', 'x'),
      'POST /auth/register': apiError(422, 'VALIDATION_ERROR', 'Request validation failed', [{ path: 'password', message: 'Password must be at least 10 characters' }]),
    });
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' });
    await userEvent.type(await screen.findByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Password must be at least 10 characters')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true'));
  });
});

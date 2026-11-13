import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { vi } from 'vitest';

/**
 * Mocks fetch with a route table: { 'GET /jira/tickets': data | (req) => ({ status, body }) }.
 * Paths match without the /api prefix and query string. Returns the list of calls made.
 */
export function mockApi(routes) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const [path, query] = String(url).replace(/^\/api/, '').split('?');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query: new URLSearchParams(query || ''), body });
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No mock for ${method} ${path}` } }), { status: 404 });
    const out = typeof handler === 'function' ? handler({ body, query: new URLSearchParams(query || '') }) : { status: 200, body: { data: handler } };
    if (out.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

export function renderWithProviders(ui, { route = '/', path = '*', extraRoutes = [] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            {extraRoutes.map(([p, el]) => (
              <Route key={p} path={p} element={el} />
            ))}
          </Routes>
        </MemoryRouter>
      </TooltipPrimitive.Provider>
    </QueryClientProvider>
  );
}

export const apiError = (status, code, message, details) => () => ({ status, body: { error: { code, message, details } } });

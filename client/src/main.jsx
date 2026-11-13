import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Toaster } from 'sonner';
import { App } from './App';
import { setUnauthorizedHandler } from './lib/api';
import { applyTheme, useThemeStore } from './stores/theme';
import { APP_NAME } from './lib/brand';
import './index.css';

document.title = APP_NAME;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => count < 2 && (!err?.status || err.status >= 500),
    },
  },
});

// Session expired or revoked: drop cached data and send the user to sign in.
setUnauthorizedHandler(() => {
  queryClient.setQueryData(['me'], null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
});

applyTheme(useThemeStore.getState().theme);

function ThemedToaster() {
  const theme = useThemeStore((s) => s.theme);
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipPrimitive.Provider>
      <ThemedToaster />
    </QueryClientProvider>
  </StrictMode>
);

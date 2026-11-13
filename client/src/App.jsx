import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, Link } from 'react-router';
import { useMe } from './hooks/useAuth';
import { APP_NAME } from './lib/brand';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui/misc';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { OverviewPage } from './pages/OverviewPage';
import { TicketsPage } from './pages/TicketsPage';
import { JobPage } from './pages/JobPage';
import { PlansPage } from './pages/PlansPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { AISettingsPage } from './pages/AISettingsPage';
import { ProfilePage } from './pages/ProfilePage';

// The plan viewer pulls in the Markdown + syntax highlighting stack; load it on demand.
const PlanPage = lazy(() => import('./pages/PlanPage').then((m) => ({ default: m.PlanPage })));

const Loading = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <Spinner className="h-5 w-5" />
  </div>
);

function RequireAuth({ children }) {
  const { data: user, isLoading, isError, error } = useMe();
  const location = useLocation();
  if (isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  if (isError) return <div className="p-8 text-danger">{error.message}</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-8 py-20">
      <h1 className="text-[22px] font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">That address doesn't match any page in {APP_NAME}.</p>
      <Link to="/" className="mt-4 inline-block font-medium text-accent hover:underline">
        Go to Overview
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="jobs/:id" element={<JobPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="plans/:id" element={<Suspense fallback={<Loading />}><PlanPage /></Suspense>} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="ai-settings" element={<AISettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

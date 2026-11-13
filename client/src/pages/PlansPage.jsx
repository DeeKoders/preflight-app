import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, FileText, Search } from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDateTime } from '../lib/utils';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel } from '../components/ui/panel';
import { Input } from '../components/ui/form';
import { Select } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/misc';
import { PlanStatusBadge, ProviderLabel } from '../components/plan/badges';

const FRESHNESS = [
  { value: 'all', label: 'All plans' },
  { value: 'fresh', label: 'Up to date' },
  { value: 'stale', label: 'Ticket changed' },
  { value: 'failed', label: 'Failed only' },
];
const PROVIDERS = [
  { value: 'all', label: 'Any provider' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
];

export function PlansPage() {
  const [params, setParams] = useSearchParams();
  const freshness = params.get('freshness') || 'all';
  const provider = params.get('provider') || 'all';
  const [search, setSearch] = useState(params.get('q') || '');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [q, freshness, provider]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const plans = useQuery({
    queryKey: ['plans', q, freshness, provider, page],
    queryFn: () => api.get('/plans', { q, freshness: freshness === 'all' ? undefined : freshness, provider: provider === 'all' ? undefined : provider, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const d = plans.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="My Plans" description="Every development plan you have generated. Each ticket shows its latest version.">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-6 pb-3 md:px-8">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search plans" placeholder="Search by key or summary" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filter by freshness" className="w-44" value={freshness} onValueChange={(v) => setParam('freshness', v)} options={FRESHNESS} />
          <Select aria-label="Filter by provider" className="w-40" value={provider} onValueChange={(v) => setParam('provider', v)} options={PROVIDERS} />
        </div>
      </PageHeader>
      <PageBody>
        {plans.isError && <ErrorState error={plans.error} onRetry={plans.refetch} />}
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13.5px]">
              <thead className="border-b border-line bg-surface-2 text-[12.5px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Ticket</th>
                  <th className="px-4 py-2.5 font-medium">Version</th>
                  <th className="px-4 py-2.5 font-medium">Generated</th>
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plans.isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3.5" colSpan={6}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))}
                {d?.plans.map((p) => {
                  const status = p.activeJobId ? 'generating' : p.status === 'failed' && !p.hasCompletedVersion ? 'failed' : p.isStale ? 'stale' : 'ready';
                  return (
                    <tr key={p.id} className={cn('hover:bg-surface-2/60', plans.isPlaceholderData && 'opacity-60')}>
                      <td className="max-w-[440px] px-4 py-3">
                        <Link to={`/plans/${p.id}`} className="group block">
                          <span className="font-mono text-[12.5px] text-muted group-hover:text-accent">{p.ticket.key}</span>
                          <span className="block truncate group-hover:underline">{p.ticket.summary}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-2">
                        v{p.version}
                        {p.versionCount > 1 && <span className="text-muted"> of {p.versionCount}</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-2">{formatDateTime(p.createdAt)}</td>
                      <td className="px-4 py-3">
                        <ProviderLabel provider={p.aiProvider} model={p.aiModel} />
                      </td>
                      <td className="px-4 py-3">
                        <PlanStatusBadge status={status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {p.status === 'completed' && (
                            <a href={`/api/plans/${p.id}/download`} download aria-label={`Download ${p.ticket.key} plan`} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink">
                              <Download className="h-4 w-4" />
                            </a>
                          )}
                          <Link to={`/plans/${p.id}`}>
                            <Button size="sm">Open</Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d && d.plans.length === 0 && (
            <EmptyState icon={FileText} title={q || freshness !== 'all' || provider !== 'all' ? 'No plans match these filters' : 'No plans yet'}>
              {q || freshness !== 'all' || provider !== 'all' ? (
                'Clear the search or filters to see all of your plans.'
              ) : (
                <>
                  Go to <Link to="/tickets" className="text-accent underline">My Tickets</Link> and choose Plan It to generate your first plan.
                </>
              )}
            </EmptyState>
          )}
          {d && d.total > d.pageSize && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-muted">
              <span>
                Page {page} of {pages}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" disabled={page === 1} onClick={() => setPage((x) => x - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" disabled={page >= pages} onClick={() => setPage((x) => x + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </PageBody>
    </>
  );
}

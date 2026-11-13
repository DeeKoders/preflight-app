import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, ListTodo, RefreshCw, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn, relativeTime } from '../lib/utils';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel } from '../components/ui/panel';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/form';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/misc';
import { SetupCallout } from '../components/plan/SetupCallout';
import { JiraStatusBadge, PlanStatusBadge, PriorityText } from '../components/plan/badges';
import { PlanItDialog } from '../components/plan/PlanItDialog';

const FILTERS = [
  ['all', 'Assigned to me'],
  ['in_progress', 'In progress'],
  ['todo', 'To do'],
  ['recent', 'Updated this week'],
  ['done', 'Completed'],
];

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TicketsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  // Jira uses cursor pagination: keep a stack of page tokens to support "previous".
  const [tokens, setTokens] = useState([null]);
  const pageToken = tokens[tokens.length - 1];
  const [planTicket, setPlanTicket] = useState(null);

  useEffect(() => setTokens([null]), [filter, q]);

  const status = useQuery({ queryKey: ['jira-status'], queryFn: () => api.get('/integrations/jira/status') });
  const tickets = useQuery({
    queryKey: ['tickets', filter, q, pageToken],
    queryFn: () => api.get('/jira/tickets', { filter, q, pageToken, pageSize: 25 }),
    enabled: Boolean(status.data?.connected),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.tickets?.some((t) => t.plan?.status === 'generating') ? 5000 : false),
  });

  const refresh = useMutation({
    mutationFn: () => api.post('/jira/tickets/refresh'),
    onSuccess: (r) => {
      toast.success(`Synced ${r.synced} assigned ticket${r.synced === 1 ? '' : 's'} from Jira`);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (status.isSuccess && !status.data.connected) {
    return (
      <>
        <PageHeader title="My Tickets" description="Jira issues assigned to you." />
        <PageBody>
          <SetupCallout kind="jira" />
        </PageBody>
      </>
    );
  }

  const data = tickets.data;
  return (
    <>
      <PageHeader
        title="My Tickets"
        description={status.data?.siteUrl ? `Issues assigned to you on ${status.data.siteUrl.replace('https://', '')}` : 'Jira issues assigned to you.'}
        actions={
          <Button onClick={() => refresh.mutate()} loading={refresh.isPending}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh from Jira
          </Button>
        }
      >
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-6 pb-3 md:px-8">
          <div role="tablist" aria-label="Ticket filter" className="flex flex-wrap gap-1">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                  filter === value ? 'bg-ink text-bg font-medium' : 'text-ink-2 hover:bg-surface-2'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search tickets" placeholder="Search by key or summary" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </PageHeader>

      <PageBody>
        {tickets.isError && <ErrorState error={tickets.error} onRetry={tickets.refetch} title="Could not load tickets from Jira" />}
        <Panel className={cn('overflow-hidden', tickets.isError && 'mt-4')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13.5px]">
              <thead className="border-b border-line bg-surface-2 text-[12.5px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Key</th>
                  <th className="px-4 py-2.5 font-medium">Summary</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(tickets.isLoading || status.isLoading) &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j} className="px-4 py-3.5">
                          <Skeleton className={cn('h-4', j === 1 ? 'w-64' : 'w-16')} />
                        </td>
                      ))}
                    </tr>
                  ))}
                {data?.tickets.map((t) => (
                  <tr key={t.id} className={cn('group hover:bg-surface-2/60', tickets.isPlaceholderData && 'opacity-60')}>
                    <td className="px-4 py-3 align-top">
                      <span className="font-mono text-[12.5px] text-ink-2">{t.key}</span>
                    </td>
                    <td className="max-w-[420px] px-4 py-3 align-top">
                      <span className="line-clamp-2">{t.summary}</span>
                    </td>
                    <td className="px-4 py-3 align-top text-ink-2">{t.issueType || '—'}</td>
                    <td className="px-4 py-3 align-top">
                      <PriorityText priority={t.priority} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <JiraStatusBadge status={t.status} category={t.statusCategory} />
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-ink-2" title={t.updated}>
                      {relativeTime(t.updated)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <PlanStatusBadge status={t.plan?.status} version={t.plan?.latestVersion} />
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex items-center justify-end gap-1.5">
                        <a href={t.url} target="_blank" rel="noreferrer" aria-label={`Open ${t.key} in Jira`} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        {t.plan?.status === 'generating' && t.plan.activeJobId ? (
                          <Link to={`/jobs/${t.plan.activeJobId}`}>
                            <Button size="sm">View progress</Button>
                          </Link>
                        ) : t.plan?.latestPlanId ? (
                          <Link to={`/plans/${t.plan.latestPlanId}`}>
                            <Button size="sm">View plan</Button>
                          </Link>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => setPlanTicket(t)}>
                            <Sparkles className="h-3.5 w-3.5" /> Plan It
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.tickets.length === 0 && (
            <EmptyState icon={ListTodo} title={q ? `No tickets match “${q}”` : 'Nothing here'}>
              {q ? 'Try a different key or keyword.' : filter === 'all' ? 'No Jira issues are assigned to you.' : 'No assigned tickets match this filter.'}
            </EmptyState>
          )}

          {data && data.tickets.length > 0 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-muted">
              <span>
                Page {tokens.length}
                {typeof data.total === 'number' && ` of about ${Math.max(1, Math.ceil(data.total / 25))} (${data.total} tickets)`}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" disabled={tokens.length === 1} onClick={() => setTokens((s) => s.slice(0, -1))} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="secondary" disabled={data.isLast || !data.nextPageToken} onClick={() => setTokens((s) => [...s, data.nextPageToken])} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </PageBody>

      <PlanItDialog open={Boolean(planTicket)} onOpenChange={(o) => !o && setPlanTicket(null)} ticket={planTicket} />
    </>
  );
}

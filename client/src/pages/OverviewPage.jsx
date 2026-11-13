import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { relativeTime } from '../lib/utils';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel, PanelHeader } from '../components/ui/panel';
import { Alert, EmptyState, ErrorState, Skeleton } from '../components/ui/misc';
import { Button } from '../components/ui/button';
import { SetupCallout } from '../components/plan/SetupCallout';
import { JiraStatusBadge, PlanStatusBadge, ProviderLabel } from '../components/plan/badges';
import { useMe } from '../hooks/useAuth';

function Count({ n, children, to }) {
  const inner = (
    <>
      <span className="font-semibold text-ink tabular-nums">{n}</span> {children}
    </>
  );
  return to && n > 0 ? (
    <Link to={to} className="underline decoration-line-strong underline-offset-4 hover:decoration-accent">
      {inner}
    </Link>
  ) : (
    <span>{inner}</span>
  );
}

/** A written status line instead of stat tiles: what needs attention, in a sentence. */
function Worklist({ counts }) {
  if (counts.assigned === 0) return <p className="text-[15px] text-ink-2">No Jira tickets are assigned to you right now.</p>;
  const plural = (n, one, many) => (n === 1 ? one : many);
  return (
    <p className="max-w-3xl text-[17px] leading-relaxed text-ink-2">
      <Count n={counts.assigned}>{plural(counts.assigned, 'ticket is', 'tickets are')} assigned to you</Count>, {counts.open} still open.{' '}
      {counts.awaitingPlanning > 0 ? (
        <>
          <Count n={counts.awaitingPlanning} to="/tickets">
            {plural(counts.awaitingPlanning, 'needs', 'need')} a plan
          </Count>
          .{' '}
        </>
      ) : (
        'Every open ticket has a plan. '
      )}
      {counts.stalePlans > 0 && (
        <>
          <Count n={counts.stalePlans} to="/plans?freshness=stale">
            {plural(counts.stalePlans, 'plan is', 'plans are')} out of date
          </Count>{' '}
          because the ticket changed in Jira.{' '}
        </>
      )}
      {counts.activeJobs > 0 && (
        <>
          {counts.activeJobs} planning {plural(counts.activeJobs, 'run is', 'runs are')} in progress.
        </>
      )}
    </p>
  );
}

export function OverviewPage() {
  const { data: user } = useMe();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/dashboard/overview') });
  const d = q.data;

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.name?.split(' ')[0] || ''}`}
        actions={
          d?.integrations.jira.connected && (
            <Button variant="secondary" onClick={() => q.refetch()} loading={q.isFetching}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          )
        }
      />
      <PageBody className="space-y-6">
        {q.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="mt-6 h-64 w-full" />
          </div>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
        {d && (
          <>
            {!d.integrations.jira.connected && <SetupCallout kind="jira" />}
            {d.integrations.jira.connected && d.integrations.jira.status === 'invalid' && (
              <Alert tone="danger" title="Jira rejected your saved API token" action={<Link to="/integrations"><Button size="sm">Reconnect</Button></Link>}>
                The token may have expired or been revoked. Reconnect Jira to keep your tickets in sync.
              </Alert>
            )}
            {!d.integrations.ai.configured && <SetupCallout kind="ai" />}
            {d.syncError && <Alert tone="warn" title="Could not refresh tickets from Jira">{d.syncError} Showing the last synced data.</Alert>}

            {d.integrations.jira.connected && (
              <div>
                <Worklist counts={d.counts} />
                {d.lastSyncedAt && <p className="mt-2 text-[12.5px] text-muted">Synced from {d.integrations.jira.siteUrl?.replace('https://', '')} {relativeTime(d.lastSyncedAt)}</p>}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
              <Panel>
                <PanelHeader title="Recently updated tickets" actions={<Link to="/tickets" className="text-[13px] font-medium text-accent hover:underline">All tickets</Link>} />
                {d.recentTickets.length === 0 ? (
                  <EmptyState title={d.integrations.jira.connected ? 'No assigned tickets' : 'Jira not connected'}>
                    {d.integrations.jira.connected ? 'Tickets assigned to you in Jira will appear here.' : 'Connect Jira to see the tickets assigned to you.'}
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.recentTickets.map((t) => (
                      <li key={t.key} className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <a href={t.url} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-muted hover:text-accent">
                              {t.key}
                            </a>
                            <JiraStatusBadge status={t.status} category={t.statusCategory} />
                          </div>
                          <p className="mt-0.5 truncate text-[13.5px]">{t.summary}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          {t.plan?.latestPlanId ? (
                            <Link to={`/plans/${t.plan.latestPlanId}`}>
                              <PlanStatusBadge status={t.plan.status} version={t.plan.latestVersion} />
                            </Link>
                          ) : (
                            <PlanStatusBadge status={t.plan?.status} />
                          )}
                          <p className="mt-1 text-[12px] text-muted">{relativeTime(t.updated)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel>
                <PanelHeader title="Recently generated plans" actions={<Link to="/plans" className="text-[13px] font-medium text-accent hover:underline">All plans</Link>} />
                {d.recentPlans.length === 0 ? (
                  <EmptyState icon={FileText} title="No plans yet">
                    Open <Link to="/tickets" className="text-accent underline">My Tickets</Link> and choose Plan It on a ticket to generate your first development plan.
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-line">
                    {d.recentPlans.map((p) => (
                      <li key={p.id}>
                        <Link to={`/plans/${p.id}`} className="block px-5 py-3 hover:bg-surface-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[12.5px] text-muted">
                              {p.ticket.key} <span className="text-ink-2">v{p.version}</span>
                            </span>
                            {p.isStale && <PlanStatusBadge status="stale" />}
                          </div>
                          <p className="mt-0.5 truncate text-[13.5px]">{p.ticket.summary}</p>
                          <div className="mt-1 flex items-center justify-between">
                            <ProviderLabel provider={p.aiProvider} model={p.aiModel} />
                            <span className="text-[12px] text-muted">{relativeTime(p.createdAt)}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            {d.integrations.jira.connected && (
              <p className="text-[12.5px] text-muted">
                Connected to{' '}
                <a href={d.integrations.jira.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                  {d.integrations.jira.siteUrl?.replace('https://', '')} <ExternalLink className="h-3 w-3" />
                </a>
                {d.integrations.ai.default && (
                  <>
                    {'. '}Default model <span className="font-mono">{d.integrations.ai.default.model}</span>
                  </>
                )}
                {d.integrations.github.connected && d.integrations.github.defaultRepository && (
                  <>
                    {'. '}Default repository <span className="font-mono">{d.integrations.github.defaultRepository}</span>
                  </>
                )}
                .
              </p>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

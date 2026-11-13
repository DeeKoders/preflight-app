import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Copy, Download, ExternalLink, GitCompare, History, RefreshCw, Sparkles } from 'lucide-react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn, formatCost, formatDateTime, formatDuration, formatNumber, relativeTime } from '../lib/utils';
import { Button, ButtonLink } from '../components/ui/button';
import { Alert, ErrorState, Skeleton } from '../components/ui/misc';
import { DropdownMenu, MenuItem, MenuLabel } from '../components/ui/menu';
import { MarkdownDocument, splitSections } from '../components/plan/MarkdownDocument';
import { PlanToc } from '../components/plan/PlanToc';
import { VersionDiff } from '../components/plan/VersionDiff';
import { PlanItDialog } from '../components/plan/PlanItDialog';
import { JiraStatusBadge, ProviderLabel } from '../components/plan/badges';

function Meta({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink-2">{children}</dd>
    </div>
  );
}

function AgentTrace({ trace }) {
  if (!trace?.toolCalls?.length) return null;
  return (
    <Collapsible.Root className="border-t border-line pt-3">
      <Collapsible.Trigger className="group flex w-full items-center justify-between text-[13px] font-medium text-ink-2 hover:text-ink">
        How the agent investigated
        <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-2">
        <p className="mb-2 text-[12.5px] text-muted">
          {trace.stats?.toolCalls ?? 0} tool calls in {trace.stats?.iterations ?? 0} turns, {trace.stats?.filesRead ?? 0} files read, {trace.stats?.issuesSeen ?? 0} Jira issues seen.
        </p>
        <ol className="space-y-1.5">
          {trace.toolCalls.map((t, i) => (
            <li key={i} className="text-[12.5px]">
              <span className={cn('font-mono', t.ok ? 'text-ink-2' : 'text-danger')}>{t.tool}</span>
              <span className="block text-muted">{t.summary || t.message || t.args}</span>
            </li>
          ))}
        </ol>
        {trace.verificationNotes?.length > 0 && (
          <div className="mt-3 rounded-md bg-surface-2 p-2.5 text-[12.5px] text-ink-2">
            <p className="mb-1 font-medium">Grounding checks applied</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {trace.verificationNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function PlanPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [regenOpen, setRegenOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const plan = useQuery({ queryKey: ['plan', id], queryFn: () => api.get(`/plans/${id}`) });
  const versions = useQuery({ queryKey: ['plan-versions', id], queryFn: () => api.get(`/plans/${id}/versions`), enabled: plan.isSuccess });
  const freshness = useMutation({
    mutationFn: () => api.post(`/plans/${id}/freshness`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['plan', id] });
      qc.invalidateQueries({ queryKey: ['plans'] });
      toast[r.stale ? 'warning' : 'success'](r.stale ? 'The Jira ticket has changed since this plan was generated.' : 'The plan is up to date with Jira.');
    },
    onError: (e) => toast.error(e.message),
  });

  const p = plan.data;
  const sections = useMemo(() => (p?.markdown ? splitSections(p.markdown).sections : []), [p?.markdown]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.markdown);
      toast.success('Markdown copied to clipboard');
    } catch {
      toast.error('Copying is blocked by the browser. Use Download instead.');
    }
  };

  if (plan.isLoading)
    return (
      <div className="mx-auto max-w-[1280px] space-y-3 px-8 py-10">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-8 h-[60vh] w-full" />
      </div>
    );
  if (plan.isError)
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <ErrorState error={plan.error} onRetry={plan.refetch} title={plan.error.status === 404 ? 'Plan not found' : 'Could not load the plan'} />
      </div>
    );

  const fresh = freshness.data;
  const stale = fresh ? fresh.stale : p.isStale;

  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-5 py-8 lg:grid-cols-[200px_minmax(0,1fr)_280px] lg:px-8">
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <PlanToc sections={sections} />
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <Link to="/plans" className="hover:text-ink">
            My Plans
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono text-[12.5px] text-ink-2">{p.ticket.key}</span>
          <JiraStatusBadge status={p.ticket.status} category={p.ticket.statusCategory} />
        </div>

        {stale && p.status === 'completed' && (
          <Alert
            tone="warn"
            className="mb-6"
            title="The Jira ticket changed after this plan was generated"
            action={
              <Button size="sm" variant="primary" onClick={() => setRegenOpen(true)}>
                Regenerate
              </Button>
            }
          >
            Jira was updated {relativeTime(fresh?.jiraUpdatedAt || p.ticket.jiraUpdatedAt)}; this plan reflects the ticket as of {formatDateTime(p.sourceJiraUpdatedAt)}. Review the
            ticket or generate a new version. Older versions are kept.
          </Alert>
        )}
        {!p.isLatest && p.latestVersionId && (
          <Alert tone="info" className="mb-6" title={`You are viewing version ${p.version}`} action={<Link to={`/plans/${p.latestVersionId}`}><Button size="sm">Open latest</Button></Link>} />
        )}
        {p.status === 'failed' && (
          <Alert tone="danger" className="mb-6" title={`Version ${p.version} failed to generate`}>
            {p.errorDetails?.message}
          </Alert>
        )}
        {p.status === 'generating' && (
          <Alert tone="info" className="mb-6" title="This version is still being generated" action={p.activeJobId && <Link to={`/jobs/${p.activeJobId}`}><Button size="sm">View progress</Button></Link>} />
        )}

        {p.markdown ? <MarkdownDocument markdown={p.markdown} /> : <p className="text-muted">No content for this version.</p>}
      </div>

      <aside className="order-first lg:order-none">
        <div className="space-y-4 lg:sticky lg:top-6">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setRegenOpen(true)} disabled={Boolean(p.activeJobId)}>
              <Sparkles className="h-3.5 w-3.5" /> {p.activeJobId ? 'Generating…' : 'Regenerate'}
            </Button>
            <Button onClick={copy} disabled={!p.markdown} aria-label="Copy Markdown">
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            {p.status === 'completed' && (
              <ButtonLink href={`/api/plans/${p.id}/download`} download aria-label="Download Markdown file">
                <Download className="h-3.5 w-3.5" /> .md
              </ButtonLink>
            )}
          </div>

          <div className="rounded-[10px] border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <DropdownMenu
                align="start"
                trigger={
                  <button className="inline-flex items-center gap-1.5 rounded-md text-[14px] font-semibold hover:text-accent">
                    <History className="h-4 w-4 text-muted" aria-hidden /> Version {p.version} of {p.versionCount}
                    <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
                  </button>
                }
              >
                <MenuLabel>Version history</MenuLabel>
                {(versions.data || []).map((v) => (
                  <MenuItem key={v.id} onSelect={() => navigate(`/plans/${v.id}`)} className={v.id === p.id ? 'font-semibold' : ''}>
                    <span className="flex w-full items-center justify-between gap-4">
                      <span>
                        v{v.version}
                        {v.status !== 'completed' && <span className="ml-1.5 text-[12px] text-muted">({v.status})</span>}
                      </span>
                      <span className="text-[12px] text-muted">{relativeTime(v.createdAt)}</span>
                    </span>
                  </MenuItem>
                ))}
              </DropdownMenu>
              {(versions.data || []).filter((v) => v.status === 'completed').length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => setDiffOpen(true)}>
                  <GitCompare className="h-3.5 w-3.5" /> Compare
                </Button>
              )}
            </div>
            <dl className="divide-y divide-line">
              <Meta label="Generated">{formatDateTime(p.createdAt)}</Meta>
              <Meta label="Model">
                <ProviderLabel provider={p.aiProvider} model={p.aiModel} />
              </Meta>
              <Meta label="Codebase">{p.repository ? <span className="font-mono text-[12px]">{p.repository}</span> : 'Not analysed'}</Meta>
              <Meta label="Duration">{formatDuration(p.generationDurationMs)}</Meta>
              <Meta label="Tokens">{p.tokenUsage ? `${formatNumber(p.tokenUsage.inputTokens + (p.tokenUsage.cacheReadTokens || 0) + (p.tokenUsage.cacheWriteTokens || 0))} in, ${formatNumber(p.tokenUsage.outputTokens)} out` : '—'}</Meta>
              <Meta label="Estimated cost">{formatCost(p.tokenUsage?.estimatedCostUsd ?? null)}</Meta>
            </dl>
          </div>

          <div className="rounded-[10px] border border-line bg-surface p-4">
            <div className="flex items-start gap-2.5">
              {stale ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />}
              <div className="min-w-0 text-[13px]">
                <p className="font-medium">{stale ? 'Ticket changed since generation' : 'Matches the Jira ticket'}</p>
                <p className="mt-0.5 text-muted">
                  Based on Jira as of {formatDateTime(p.sourceJiraUpdatedAt)}
                  {fresh && `. Checked ${relativeTime(fresh.checkedAt)}`}.
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => freshness.mutate()} loading={freshness.isPending}>
                <RefreshCw className="h-3.5 w-3.5" /> Check Jira now
              </Button>
              {p.jiraUrl && (
                <ButtonLink size="sm" variant="ghost" href={p.jiraUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Open in Jira
                </ButtonLink>
              )}
            </div>
          </div>

          <AgentTrace trace={p.agentTrace} />
        </div>
      </aside>

      <PlanItDialog open={regenOpen} onOpenChange={setRegenOpen} ticket={{ key: p.ticket.key, summary: p.ticket.summary }} planId={p.id} />
      {versions.data && diffOpen && <VersionDiff open={diffOpen} onOpenChange={setDiffOpen} planId={p.id} versions={versions.data} defaultTarget={p.version} />}
    </div>
  );
}

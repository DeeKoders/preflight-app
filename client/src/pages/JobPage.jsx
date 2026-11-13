import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleDashed, Loader2, Minus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn, formatDateTime } from '../lib/utils';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel, PanelHeader } from '../components/ui/panel';
import { Button } from '../components/ui/button';
import { Alert, ErrorState, Skeleton } from '../components/ui/misc';
import { JobStatusBadge, ProviderLabel } from '../components/plan/badges';

const ICONS = {
  done: [Check, 'bg-ok text-white'],
  active: [Loader2, 'bg-accent-soft text-accent'],
  pending: [CircleDashed, 'bg-surface-2 text-muted'],
  skipped: [Minus, 'bg-surface-2 text-muted'],
  failed: [X, 'bg-danger text-white'],
};

/** Vertical timeline of real agent stages (no synthetic percentages). */
export function StageTimeline({ stages = [], jobStatus }) {
  return (
    <ol className="relative">
      {stages.map((s, i) => {
        const status = s.status === 'active' && jobStatus === 'queued' ? 'pending' : s.status;
        const [Icon, cls] = ICONS[status] || ICONS.pending;
        return (
          <li key={s.id} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < stages.length - 1 && <span className="absolute top-7 left-[13px] h-[calc(100%-24px)] w-px bg-line" aria-hidden />}
            <span className={cn('relative z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full', cls)}>
              <Icon className={cn('h-3.5 w-3.5', status === 'active' && 'animate-spin')} aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn('text-[14px]', status === 'active' ? 'font-semibold text-ink' : status === 'pending' || status === 'skipped' ? 'text-muted' : 'text-ink')}>
                {s.label}
                <span className="sr-only"> — {status}</span>
              </p>
              {s.note && <p className="mt-0.5 text-[12.5px] text-muted">{s.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const DEFAULT_STAGES = [
  'Fetching Jira ticket',
  'Understanding requirements',
  'Investigating related issues',
  'Exploring codebase',
  'Analyzing impact, building checklist & QA scenarios',
  'Validating plan & evidence',
  'Saving development plan',
].map((label, i) => ({ id: String(i), label, status: 'pending' }));

export function JobPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get(`/planning-jobs/${id}`),
    refetchInterval: (q) => (['queued', 'running'].includes(q.state.data?.status) ? 1500 : false),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/planning-jobs/${id}/cancel`),
    onSuccess: () => {
      toast.success('Planning cancelled');
      job.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const j = job.data;
  useEffect(() => {
    if (j?.status === 'completed') {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['plans'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    }
  }, [j?.status, qc]);

  const active = ['queued', 'running'].includes(j?.status);
  const stages = j?.progress?.stages || DEFAULT_STAGES;
  const events = [...(j?.progress?.events || [])].reverse();

  return (
    <>
      <PageHeader
        title={j ? `Planning ${j.ticket?.key}` : 'Planning'}
        description={j?.ticket?.summary}
        actions={
          j && (
            <>
              <JobStatusBadge status={j.status} />
              {active && (
                <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                  Cancel
                </Button>
              )}
              {j.status === 'completed' && j.planId && (
                <Button variant="primary" onClick={() => navigate(`/plans/${j.planId}`)}>
                  Open plan
                </Button>
              )}
            </>
          )
        }
      />
      <PageBody className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {job.isLoading && <Skeleton className="h-80" />}
        {job.isError && <ErrorState error={job.error} onRetry={job.refetch} />}
        {j && (
          <>
            <div className="space-y-4">
              <Panel className="p-5">
                <StageTimeline stages={stages} jobStatus={j.status} />
              </Panel>
              <Panel className="space-y-2 p-5 text-[13px]">
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Model</span>
                  <ProviderLabel provider={j.provider} model={j.model} />
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Codebase</span>
                  <span className={j.repository ? 'font-mono text-[12.5px]' : 'text-muted'}>{j.repository || 'Not included'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Started</span>
                  <span>{formatDateTime(j.startedAt || j.createdAt)}</span>
                </div>
                {j.attempts > 1 && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Attempt</span>
                    <span>{j.attempts}</span>
                  </div>
                )}
              </Panel>
            </div>

            <div className="space-y-4">
              {j.status === 'queued' && j.errorMessage && (
                <Alert tone="warn" title="Retrying shortly">
                  {j.errorMessage}
                </Alert>
              )}
              {j.status === 'failed' && (
                <Alert
                  tone="danger"
                  title="The plan could not be generated"
                  action={
                    <Link to="/tickets">
                      <Button size="sm">Back to tickets</Button>
                    </Link>
                  }
                >
                  {j.errorMessage}
                </Alert>
              )}
              {j.status === 'cancelled' && <Alert tone="info" title="This planning run was cancelled." />}
              {j.status === 'completed' && (
                <Alert tone="ok" title={`Version ${j.planVersion} of the plan is ready`} action={<Button size="sm" variant="primary" onClick={() => navigate(`/plans/${j.planId}`)}>Open plan</Button>} />
              )}
              {active && (
                <p className="text-[13.5px] text-muted">
                  You can leave this page — planning continues in the background and the run stays listed in the sidebar.
                </p>
              )}
              <Panel>
                <PanelHeader title="Agent activity" description="Each read-only lookup the agent performed." />
                {events.length === 0 ? (
                  <p className="px-5 py-6 text-[13.5px] text-muted">{active ? 'Waiting for the agent to start…' : 'No activity was recorded.'}</p>
                ) : (
                  <ol className="divide-y divide-line" aria-live="polite">
                    {events.map((e, i) => (
                      <li key={`${e.at}-${i}`} className="flex gap-3 px-5 py-2.5 text-[13px]">
                        <time className="w-16 shrink-0 font-mono text-[12px] text-muted">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                        {e.level === 'warn' && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-label="Warning" />}
                        <span className={e.level === 'warn' ? 'text-warn' : 'text-ink-2'}>{e.message}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

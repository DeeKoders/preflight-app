import { Badge } from '../ui/badge';
import { PROVIDER_LABELS } from '../../lib/utils';

const STATUS_TONE = { todo: 'neutral', in_progress: 'info', done: 'ok' };

export function JiraStatusBadge({ status, category }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Badge tone={STATUS_TONE[category] || 'neutral'}>{status}</Badge>;
}

const PLAN_STATUS = {
  none: ['neutral', 'Not planned'],
  generating: ['accent', 'Generating'],
  ready: ['ok', 'Plan ready'],
  stale: ['warn', 'Plan outdated'],
  failed: ['danger', 'Last run failed'],
};

export function PlanStatusBadge({ status = 'none', version }) {
  const [tone, label] = PLAN_STATUS[status] || PLAN_STATUS.none;
  return (
    <Badge tone={tone} dot={status === 'generating'}>
      {label}
      {version && (status === 'ready' || status === 'stale') ? <span className="opacity-70">v{version}</span> : null}
    </Badge>
  );
}

const JOB_STATUS = {
  queued: ['neutral', 'Queued'],
  running: ['accent', 'Running'],
  completed: ['ok', 'Completed'],
  failed: ['danger', 'Failed'],
  cancelled: ['neutral', 'Cancelled'],
};
export function JobStatusBadge({ status }) {
  const [tone, label] = JOB_STATUS[status] || ['neutral', status];
  return (
    <Badge tone={tone} dot={status === 'running'}>
      {label}
    </Badge>
  );
}

export function ProviderLabel({ provider, model }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span className="text-ink-2">{PROVIDER_LABELS[provider] || provider}</span>
      {model && <span className="font-mono text-[12px] text-muted">{model}</span>}
    </span>
  );
}

export function PriorityText({ priority }) {
  if (!priority) return <span className="text-muted">—</span>;
  const strong = /highest|critical|blocker|high/i.test(priority);
  return <span className={strong ? 'font-medium text-ink' : 'text-ink-2'}>{priority}</span>;
}

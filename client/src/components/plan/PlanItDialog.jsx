import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field } from '../ui/form';
import { Select } from '../ui/select';
import { Alert } from '../ui/misc';
import { PROVIDER_LABELS } from '../../lib/utils';

const NO_REPO = '__none__';

/**
 * Confirmation step for "Plan It": choose the AI provider and (optionally)
 * the GitHub repository for codebase analysis, then start the background job.
 * `planId` switches the dialog to regenerate mode.
 */
export function PlanItDialog({ open, onOpenChange, ticket, planId }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get('/ai/settings'), enabled: open });
  const github = useQuery({ queryKey: ['github-status'], queryFn: () => api.get('/integrations/github/status'), enabled: open });

  const [settingId, setSettingId] = useState('');
  const [repo, setRepo] = useState(NO_REPO);

  useEffect(() => {
    if (!open) return;
    const def = settings.data?.find((s) => s.isDefault) || settings.data?.[0];
    if (def) setSettingId(def.id);
  }, [open, settings.data]);
  useEffect(() => {
    if (!open) return;
    setRepo(github.data?.connected && github.data.status === 'connected' && github.data.defaultRepository ? github.data.defaultRepository : NO_REPO);
  }, [open, github.data]);

  const repoOptions = useMemo(
    () => [
      { value: NO_REPO, label: 'No repository (Jira only)', hint: 'The plan will note that codebase analysis was unavailable' },
      ...(github.data?.selectedRepositories || []).map((r) => ({ value: r, label: r })),
    ],
    [github.data]
  );

  const start = useMutation({
    mutationFn: () => {
      const body = { aiSettingId: settingId, repository: repo === NO_REPO ? null : repo };
      return planId ? api.post(`/plans/${planId}/regenerate`, body) : api.post('/plans', { issueKey: ticket.key, ...body });
    },
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      onOpenChange(false);
      toast.success(`Planning started for ${ticket.key}`);
      navigate(`/jobs/${job.id}`);
    },
    onError: (err) => {
      if (err.code === 'CONFLICT' && err.details?.jobId) {
        onOpenChange(false);
        toast.info('A plan is already being generated for this ticket.');
        navigate(`/jobs/${err.details.jobId}`);
      }
    },
  });

  const noProviders = settings.isSuccess && settings.data.length === 0;
  const selected = settings.data?.find((s) => s.id === settingId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={planId ? `Regenerate plan for ${ticket?.key}` : `Plan ${ticket?.key}`}
      description={ticket?.summary}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => start.mutate()} loading={start.isPending} disabled={!settingId || noProviders}>
            {planId ? 'Generate new version' : 'Start planning'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {noProviders ? (
          <Alert tone="warn" title="No AI provider configured">
            Add your API key on the <Link className="underline" to="/ai-settings">AI Settings</Link> page first.
          </Alert>
        ) : (
          <Field label="AI provider" hint={selected?.validationStatus === 'invalid' ? 'This key failed its last test — planning will likely fail.' : 'Usage is billed to your own provider account.'}>
            {(p) => (
              <Select
                {...p}
                value={settingId}
                onValueChange={setSettingId}
                options={(settings.data || []).map((s) => ({ value: s.id, label: `${PROVIDER_LABELS[s.provider]} — ${s.model}${s.isDefault ? ' (default)' : ''}` }))}
              />
            )}
          </Field>
        )}

        <Field
          label="Codebase"
          hint={
            github.data?.connected
              ? 'The agent can search and read files in the selected repository (read-only).'
              : 'Connect GitHub on the Integrations page to ground the plan in real code.'
          }
        >
          {(p) => <Select {...p} value={repo} onValueChange={setRepo} options={repoOptions} disabled={!github.data?.connected} />}
        </Field>

        <p className="text-[13px] text-muted">
          The agent reads the ticket, comments, linked issues and related context, then drafts a structured plan. It never modifies Jira or your repository.
          {planId && ' Previous versions are kept.'}
        </p>

        {start.isError && start.error.code !== 'CONFLICT' && <Alert tone="danger" title="Could not start planning">{start.error.message}</Alert>}
      </div>
    </Dialog>
  );
}

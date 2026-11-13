import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, GitBranch, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '../components/ui/panel';
import { Button } from '../components/ui/button';
import { Field, Input, fieldErrors } from '../components/ui/form';
import { Alert, Skeleton, Spinner } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { ConfirmDialog } from '../components/ui/dialog';
import { Select } from '../components/ui/select';
import { APP_NAME } from '../lib/brand';

function ConnectionBadge({ status }) {
  if (!status?.connected) return <Badge>Not connected</Badge>;
  return status.status === 'invalid' ? <Badge tone="danger">Needs attention</Badge> : <Badge tone="ok" dot>Connected</Badge>;
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-[13.5px]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

export function JiraCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['jira-status'], queryFn: () => api.get('/integrations/jira/status') });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({ siteUrl: '', email: '', apiToken: '' });
  const invalidate = () => ['jira-status', 'tickets', 'overview'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const connect = useMutation({
    mutationFn: () => api.post('/integrations/jira/connect', form),
    onSuccess: (d) => {
      toast.success(`Connected to Jira as ${d.jiraDisplayName}`);
      setEditing(false);
      setForm({ siteUrl: '', email: '', apiToken: '' });
      invalidate();
    },
  });
  const test = useMutation({
    mutationFn: () => api.post('/integrations/jira/test'),
    onSuccess: (d) => toast.success(`Jira connection works — signed in as ${d.account.displayName}`),
    onError: (e) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['jira-status'] }),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete('/integrations/jira'),
    onSuccess: () => {
      toast.success('Jira disconnected and the stored token deleted');
      setConfirm(false);
      invalidate();
    },
  });

  const s = status.data;
  const showForm = !s?.connected || editing;
  const errors = fieldErrors(connect.error);

  return (
    <Panel>
      <PanelHeader title="Jira Cloud" description={`Reads the issues assigned to you. ${APP_NAME} never writes to Jira.`} actions={<ConnectionBadge status={s} />} />
      <PanelBody className="space-y-4">
        {status.isLoading && <Skeleton className="h-24" />}
        {s?.connected && !editing && (
          <>
            {s.status === 'invalid' && <Alert tone="danger" title="Jira rejected the saved token">{s.lastError} Update the token to reconnect.</Alert>}
            <div className="divide-y divide-line">
              <Row label="Site">
                <a href={s.siteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                  {s.siteUrl.replace('https://', '')} <ExternalLink className="h-3 w-3" />
                </a>
              </Row>
              <Row label="Account">
                {s.jiraDisplayName} <span className="text-muted">({s.accountEmail})</span>
              </Row>
              <Row label="API token">
                <span className="font-mono text-[12.5px]">{s.tokenMask}</span>
              </Row>
              <Row label="Last verified">{formatDateTime(s.lastValidatedAt)}</Row>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => test.mutate()} loading={test.isPending}>
                Test connection
              </Button>
              <Button onClick={() => setEditing(true)}>Update credentials</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                Disconnect
              </Button>
            </div>
          </>
        )}
        {showForm && !status.isLoading && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
            {connect.isError && !Object.keys(errors).length && <Alert tone="danger" title="Could not connect to Jira">{connect.error.message}</Alert>}
            <Field label="Jira site URL" error={errors.siteUrl} hint="For example https://your-team.atlassian.net">
              {(p) => <Input {...p} placeholder="https://your-team.atlassian.net" value={form.siteUrl} onChange={(e) => setForm({ ...form, siteUrl: e.target.value })} required />}
            </Field>
            <Field label="Atlassian account email" error={errors.email}>
              {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />}
            </Field>
            <Field
              label="API token"
              error={errors.apiToken}
              hint={
                <>
                  Create one at{' '}
                  <a className="text-accent underline" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
                    id.atlassian.com → Security → API tokens
                  </a>
                  . It is encrypted at rest and never shown again.
                </>
              }
            >
              {(p) => <Input {...p} type="password" autoComplete="off" value={form.apiToken} onChange={(e) => setForm({ ...form, apiToken: e.target.value })} required />}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={connect.isPending}>
                Verify and connect
              </Button>
              {editing && (
                <Button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </PanelBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect Jira?"
        description="The stored API token is deleted. Your existing plans are kept, but tickets will no longer sync and new plans can't be generated until you reconnect."
        confirmLabel="Disconnect Jira"
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Panel>
  );
}

function RepositoryPicker({ status }) {
  const qc = useQueryClient();
  const repos = useQuery({ queryKey: ['github-repos'], queryFn: () => api.get('/github/repositories') });
  const [selected, setSelected] = useState(status.selectedRepositories || []);
  const [def, setDef] = useState(status.defaultRepository || '');
  const [filter, setFilter] = useState('');
  const save = useMutation({
    mutationFn: () => api.put('/integrations/github/repositories', { selectedRepositories: selected, defaultRepository: selected.includes(def) ? def : selected[0] || null }),
    onSuccess: () => {
      toast.success('Repository selection saved');
      qc.invalidateQueries({ queryKey: ['github-status'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const toggle = (name) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  const list = (repos.data?.repositories || []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] font-medium">Repositories the agent may read</p>
        <Input className="h-8 w-52" placeholder="Filter repositories" aria-label="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {repos.isLoading && <Spinner />}
      {repos.isError && <Alert tone="danger">{repos.error.message}</Alert>}
      {repos.data && (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {list.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">No repositories match.</li>}
          {list.map((r) => (
            <li key={r.fullName}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-surface-2">
                <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={selected.includes(r.fullName)} onChange={() => toggle(r.fullName)} />
                <span className="min-w-0">
                  <span className="font-mono text-[12.5px]">{r.fullName}</span>
                  {r.private && <Badge className="ml-2">Private</Badge>}
                  {r.description && <span className="block truncate text-[12.5px] text-muted">{r.description}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <Field label="Default repository" hint="Pre-selected when you start planning; you can change it per run.">
          {(p) => <Select {...p} value={selected.includes(def) ? def : selected[0]} onValueChange={setDef} options={selected.map((r) => ({ value: r, label: r }))} />}
        </Field>
      )}
      <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
        Save selection
      </Button>
    </div>
  );
}

export function GitHubCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['github-status'], queryFn: () => api.get('/integrations/github/status') });
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const connect = useMutation({
    mutationFn: () => api.post('/integrations/github/connect', { token }),
    onSuccess: (d) => {
      toast.success(`Connected to GitHub as ${d.githubUsername}`);
      setToken('');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['github-status'] });
      qc.invalidateQueries({ queryKey: ['github-repos'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api.post('/integrations/github/test'),
    onSuccess: (d) => toast.success(`GitHub connection works — signed in as ${d.account.login}`),
    onError: (e) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['github-status'] }),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete('/integrations/github'),
    onSuccess: () => {
      toast.success('GitHub disconnected');
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ['github-status'] });
    },
  });
  const s = status.data;

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GitBranch className="h-4 w-4" aria-hidden /> GitHub <span className="font-normal text-muted">(optional)</span>
          </span>
        }
        description="Lets the agent search and read code in repositories you choose, so plans reference real files. Read-only."
        actions={<ConnectionBadge status={s} />}
      />
      <PanelBody className="space-y-4">
        {status.isLoading && <Skeleton className="h-20" />}
        {s?.connected && !editing && (
          <>
            {s.status === 'invalid' && <Alert tone="danger" title="GitHub rejected the saved token">{s.lastError}</Alert>}
            <div className="divide-y divide-line">
              <Row label="Account">{s.githubUsername}</Row>
              <Row label="Token">
                <span className="font-mono text-[12.5px]">{s.tokenMask}</span>
              </Row>
              <Row label="Last verified">{formatDateTime(s.lastValidatedAt)}</Row>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => test.mutate()} loading={test.isPending}>
                Test connection
              </Button>
              <Button onClick={() => setEditing(true)}>Replace token</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                Disconnect
              </Button>
            </div>
            <div className="border-t border-line pt-4">
              <RepositoryPicker key={(s.selectedRepositories || []).join(',')} status={s} />
            </div>
          </>
        )}
        {(!s?.connected || editing) && !status.isLoading && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
            {connect.isError && <Alert tone="danger" title="Could not connect to GitHub">{connect.error.message}</Alert>}
            <Field
              label="Personal access token"
              hint={
                <>
                  Use a{' '}
                  <a className="text-accent underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                    fine-grained token
                  </a>{' '}
                  with read-only <span className="font-mono">Contents</span> and <span className="font-mono">Metadata</span> access to the repositories you want analysed.
                </>
              }
            >
              {(p) => <Input {...p} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={connect.isPending}>
                Verify and connect
              </Button>
              {editing && (
                <Button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </PanelBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect GitHub?"
        description="The stored token and repository selection are deleted. New plans will be generated from Jira only."
        confirmLabel="Disconnect GitHub"
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Panel>
  );
}

export function IntegrationsPage() {
  return (
    <>
      <PageHeader title="Integrations" description="Your personal connections. Credentials are encrypted at rest and only ever used on the server on your behalf." />
      <PageBody className="grid max-w-[1180px] gap-6 lg:grid-cols-2">
        <JiraCard />
        <GitHubCard />
        <p className="flex items-center gap-2 text-[12.5px] text-muted lg:col-span-2">
          <Plug className="h-3.5 w-3.5" aria-hidden /> Each person connects their own accounts. Nobody else in your organisation can see or use your credentials.
        </p>
      </PageBody>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { formatCost, formatDateTime, formatNumber, PROVIDER_LABELS } from '../lib/utils';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '../components/ui/panel';
import { Button } from '../components/ui/button';
import { Field, Input, Label } from '../components/ui/form';
import { Alert, Skeleton, Switch } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { ConfirmDialog } from '../components/ui/dialog';
import { Select } from '../components/ui/select';

const CUSTOM = '__custom__';

function priceHint(pricing) {
  return pricing ? `$${pricing.input} / $${pricing.output} per 1M tokens (in/out)` : 'Pricing not listed — cost will show as not available';
}

export function ProviderCard({ provider, setting }) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(setting?.model || provider.suggestedModels[0]?.id || '');
  const [customModel, setCustomModel] = useState('');
  const [isDefault, setIsDefault] = useState(Boolean(setting?.isDefault));
  const [liveModels, setLiveModels] = useState(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setIsDefault(Boolean(setting?.isDefault));
    if (setting?.model) setModel(setting.model);
  }, [setting?.isDefault, setting?.model]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ai-settings'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const loadModels = useMutation({
    mutationFn: () => api.post('/ai/models', apiKey ? { provider: provider.id, apiKey } : { settingId: setting.id }),
    onSuccess: (models) => {
      setLiveModels(models);
      toast.success(`${models.length} model${models.length === 1 ? '' : 's'} available to this key`);
    },
    onError: (e) => toast.error(e.message),
  });

  const effectiveModel = model === CUSTOM ? customModel.trim() : model;
  const save = useMutation({
    mutationFn: () => api.post('/ai/settings', { provider: provider.id, model: effectiveModel, ...(apiKey ? { apiKey } : {}), isDefault }),
    onSuccess: () => {
      toast.success(`${provider.label} settings saved${apiKey ? ' — key verified' : ''}`);
      setApiKey('');
      invalidate();
    },
  });
  const test = useMutation({
    mutationFn: () => api.post('/ai/settings/test', apiKey ? { provider: provider.id, apiKey, model: effectiveModel } : { settingId: setting.id, model: effectiveModel }),
    onSuccess: (r) => toast.success(`${provider.label} responded in ${(r.latencyMs / 1000).toFixed(1)}s using ${r.model}`),
    onError: (e) => toast.error(e.message),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/ai/settings/${setting.id}`),
    onSuccess: () => {
      toast.success(`${provider.label} key removed`);
      setConfirm(false);
      setLiveModels(null);
      invalidate();
    },
  });

  const models = liveModels || provider.suggestedModels;
  const options = useMemo(() => {
    const list = models.map((m) => ({ value: m.id, label: m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id, hint: liveModels ? priceHint(m.pricing) : undefined }));
    if (setting?.model && !list.some((o) => o.value === setting.model)) list.unshift({ value: setting.model, label: setting.model });
    list.push({ value: CUSTOM, label: 'Other model id…' });
    return list;
  }, [models, liveModels, setting?.model]);

  const status = !setting ? <Badge>Not configured</Badge> : setting.validationStatus === 'invalid' ? <Badge tone="danger">Key failed</Badge> : <Badge tone="ok" dot>Configured</Badge>;

  return (
    <Panel>
      <PanelHeader
        title={provider.label}
        description={
          <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
            Get an API key <ExternalLink className="h-3 w-3" />
          </a>
        }
        actions={
          <>
            {setting?.isDefault && <Badge tone="accent">Default</Badge>}
            {status}
          </>
        }
      />
      <PanelBody>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {setting?.validationStatus === 'invalid' && setting.lastError && <Alert tone="danger">{setting.lastError}</Alert>}
          {save.isError && <Alert tone="danger" title="Settings not saved">{save.error.message}</Alert>}
          <Field label="API key" hint={setting ? `Saved key ${setting.keyMask}. Leave empty to keep it.` : `Starts with ${provider.keyPrefix}…`}>
            {(p) => (
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input {...p} type="password" autoComplete="off" className="pl-8" placeholder={setting ? setting.keyMask : 'Paste your API key'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
            )}
          </Field>
          <div className="space-y-1.5">
            <div className="flex items-end justify-between">
              <Label>Model</Label>
              <Button type="button" variant="link" size="sm" onClick={() => loadModels.mutate()} loading={loadModels.isPending} disabled={!apiKey && !setting}>
                {liveModels ? 'Reload models' : 'Load models for this key'}
              </Button>
            </div>
            <Select aria-label={`${provider.label} model`} value={model} onValueChange={setModel} options={options} />
            {model === CUSTOM && <Input aria-label="Custom model id" placeholder="exact-model-id" value={customModel} onChange={(e) => setCustomModel(e.target.value)} />}
            {!liveModels && <p className="text-[12.5px] text-muted">Suggested models are shown. Load models to see everything your key can access.</p>}
          </div>
          <label className="flex items-center justify-between gap-3 text-[13.5px]">
            <span>
              Use as default provider
              <span className="block text-[12.5px] text-muted">Pre-selected when you start planning. Runs never switch providers automatically.</span>
            </span>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} aria-label="Use as default provider" />
          </label>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!effectiveModel || (!setting && !apiKey)}>
              {setting ? 'Save changes' : 'Verify and save'}
            </Button>
            <Button type="button" onClick={() => test.mutate()} loading={test.isPending} disabled={!effectiveModel || (!setting && !apiKey)}>
              Test connection
            </Button>
            {setting && (
              <Button type="button" variant="danger" className="ml-auto" onClick={() => setConfirm(true)}>
                Remove key
              </Button>
            )}
          </div>
          {setting?.lastValidatedAt && <p className="text-[12.5px] text-muted">Last verified {formatDateTime(setting.lastValidatedAt)}</p>}
        </form>
      </PanelBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove your ${provider.label} key?`}
        description="The encrypted key is deleted. Existing plans are kept; new plans need another provider or a new key."
        confirmLabel="Remove key"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Panel>
  );
}

function UsagePanel() {
  const [days, setDays] = useState('30');
  const usage = useQuery({ queryKey: ['ai-usage', days], queryFn: () => api.get('/ai/usage', { days }) });
  const u = usage.data;
  return (
    <Panel className="lg:col-span-3">
      <PanelHeader
        title="Usage"
        description="Tokens reported by your providers. Costs are estimates from published list prices; they're shown only when the model's pricing is known."
        actions={
          <Select
            aria-label="Usage period"
            className="w-36"
            value={days}
            onValueChange={setDays}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
          />
        }
      />
      {usage.isLoading && <Skeleton className="m-5 h-24" />}
      {u && (
        <div className="px-5 py-4">
          <p className="text-[15px] text-ink-2">
            <span className="font-semibold text-ink tabular-nums">{formatNumber(u.totals.requests)}</span> requests,{' '}
            <span className="font-semibold text-ink tabular-nums">{formatNumber(u.totals.inputTokens)}</span> input and{' '}
            <span className="font-semibold text-ink tabular-nums">{formatNumber(u.totals.outputTokens)}</span> output tokens. Estimated cost{' '}
            <span className="font-semibold text-ink">{formatCost(u.totals.estimatedCost)}</span>
            {u.totals.estimatedCost === null && u.totals.requests > 0 && ' (some models have no listed pricing)'}.
          </p>
          {u.breakdown.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="bg-surface-2 text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 text-right font-medium">Requests</th>
                    <th className="px-3 py-2 text-right font-medium">Input</th>
                    <th className="px-3 py-2 text-right font-medium">Output</th>
                    <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {u.breakdown.map((b) => (
                    <tr key={`${b.provider}-${b.model}`}>
                      <td className="px-3 py-2">{PROVIDER_LABELS[b.provider]}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{b.model}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(b.requests)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(b.inputTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(b.outputTokens)}</td>
                      <td className="px-3 py-2 text-right">{formatCost(b.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export function AISettingsPage() {
  const providers = useQuery({ queryKey: ['ai-providers'], queryFn: () => api.get('/ai/providers'), staleTime: Infinity });
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get('/ai/settings') });
  return (
    <>
      <PageHeader
        title="AI Settings"
        description="Bring your own key. Plans are generated with your API key and billed by the provider to your account. Keys are encrypted and never displayed again after saving."
      />
      <PageBody className="space-y-6">
        {settings.isSuccess && settings.data.length === 0 && (
          <Alert tone="info" title="Add at least one provider to start planning">
            The first provider you save becomes your default. You can configure several and pick one each time you plan.
          </Alert>
        )}
        <div className="grid gap-6 lg:grid-cols-3">
          {(providers.isLoading || settings.isLoading) && [0, 1, 2].map((i) => <Skeleton key={i} className="h-96" />)}
          {providers.data &&
            settings.data &&
            providers.data.map((p) => <ProviderCard key={p.id} provider={p} setting={settings.data.find((s) => s.provider === p.id)} />)}
          <UsagePanel />
        </div>
      </PageBody>
    </>
  );
}

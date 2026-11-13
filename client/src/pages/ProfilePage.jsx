import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import { useMe } from '../hooks/useAuth';
import { useThemeStore } from '../stores/theme';
import { PageBody, PageHeader } from '../components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '../components/ui/panel';
import { Button } from '../components/ui/button';
import { Field, Input, fieldErrors } from '../components/ui/form';
import { Alert } from '../components/ui/misc';
import { Select } from '../components/ui/select';

export function ProfilePage() {
  const qc = useQueryClient();
  const { data: user } = useMe();
  const { theme, setTheme } = useThemeStore();
  const [name, setName] = useState(user?.name || '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  const saveName = useMutation({
    mutationFn: () => api.patch('/profile', { name }),
    onSuccess: (d) => {
      qc.setQueryData(['me'], d.user);
      toast.success('Profile updated');
    },
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/profile/password', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed');
    },
  });
  const pwErrors = fieldErrors(changePw.error);

  return (
    <>
      <PageHeader title="Profile" description={user ? `Member since ${formatDateTime(user.createdAt)}` : undefined} />
      <PageBody className="grid max-w-3xl gap-6">
        <Panel>
          <PanelHeader title="Account" />
          <PanelBody>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveName.mutate();
              }}
            >
              {saveName.isError && <Alert tone="danger">{saveName.error.message}</Alert>}
              <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
              <Field label="Email" hint="Your sign-in email can't be changed.">
                {(p) => <Input {...p} value={user?.email || ''} disabled />}
              </Field>
              <Button type="submit" variant="primary" loading={saveName.isPending} disabled={!name.trim() || name === user?.name}>
                Save name
              </Button>
            </form>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Password" />
          <PanelBody>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                changePw.mutate();
              }}
            >
              {changePw.isError && !Object.keys(pwErrors).length && <Alert tone="danger">{changePw.error.message}</Alert>}
              <Field label="Current password" error={pwErrors.currentPassword}>
                {(p) => <Input {...p} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />}
              </Field>
              <Field label="New password" error={pwErrors.newPassword} hint="At least 10 characters, with letters and numbers.">
                {(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />}
              </Field>
              <Button type="submit" variant="primary" loading={changePw.isPending}>
                Change password
              </Button>
            </form>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Appearance" />
          <PanelBody>
            <Field label="Theme">
              {(p) => (
                <Select
                  {...p}
                  className="w-48"
                  value={theme}
                  onValueChange={setTheme}
                  options={[
                    { value: 'system', label: 'Match system' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
              )}
            </Field>
          </PanelBody>
        </Panel>
      </PageBody>
    </>
  );
}

import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useAuthMutation, useMe } from '../hooks/useAuth';
import { Button } from '../components/ui/button';
import { Field, Input, fieldErrors } from '../components/ui/form';
import { Alert } from '../components/ui/misc';
import { Logo } from '../components/layout/AppShell';
import { APP_NAME } from '../lib/brand';

function AuthFrame({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen items-start justify-center px-4 pt-[12vh]">
      <div className="w-full max-w-[380px]">
        <Logo className="mb-8" />
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
        <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>
        <div className="mt-6">{children}</div>
        <p className="mt-6 text-[13.5px] text-muted">{footer}</p>
      </div>
    </div>
  );
}

function AuthForm({ kind }) {
  const navigate = useNavigate();
  const location = useLocation();
  const mutation = useAuthMutation(kind);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const errors = fieldErrors(mutation.error);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const body = kind === 'register' ? form : { email: form.email, password: form.password };
    mutation.mutate(body, { onSuccess: () => navigate(location.state?.from || '/', { replace: true }) });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {mutation.isError && !Object.keys(errors).length && <Alert tone="danger">{mutation.error.message}</Alert>}
      {kind === 'register' && (
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" value={form.name} onChange={set('name')} required />}
        </Field>
      )}
      <Field label="Work email" error={errors.email}>
        {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={set('email')} required />}
      </Field>
      <Field label="Password" error={errors.password} hint={kind === 'register' ? 'At least 10 characters, with letters and numbers.' : undefined}>
        {(p) => (
          <Input {...p} type="password" autoComplete={kind === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} required />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={mutation.isPending}>
        {kind === 'register' ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  );
}

function RedirectIfAuthed({ children }) {
  const { data: user, isLoading } = useMe();
  if (isLoading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export function LoginPage() {
  return (
    <RedirectIfAuthed>
      <AuthFrame
        title="Sign in"
        subtitle="Plan your Jira tickets before you write a line of code."
        footer={
          <>
            New to {APP_NAME}?{' '}
            <Link to="/register" className="font-medium text-accent hover:underline">
              Create an account
            </Link>
          </>
        }
      >
        <AuthForm kind="login" />
      </AuthFrame>
    </RedirectIfAuthed>
  );
}

export function RegisterPage() {
  return (
    <RedirectIfAuthed>
      <AuthFrame
        title="Create your account"
        subtitle="You'll connect your own Jira account and AI provider next."
        footer={
          <>
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <AuthForm kind="register" />
      </AuthFrame>
    </RedirectIfAuthed>
  );
}

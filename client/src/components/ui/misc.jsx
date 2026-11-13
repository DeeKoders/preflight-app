import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { AlertTriangle, Info, Loader2, OctagonX, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

export function Spinner({ className, label = 'Loading' }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} aria-label={label} role="status" />;
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden />;
}

const alertTones = {
  info: ['bg-info-soft text-info', Info],
  warn: ['bg-warn-soft text-warn', AlertTriangle],
  danger: ['bg-danger-soft text-danger', OctagonX],
  ok: ['bg-ok-soft text-ok', CheckCircle2],
};

export function Alert({ tone = 'info', title, children, action, className }) {
  const [cls, Icon] = alertTones[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-lg px-4 py-3', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px]">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('text-ink-2', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Empty states point at the next action. */
export function EmptyState({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-2">
          <Icon className="h-5 w-5 text-muted" aria-hidden />
        </div>
      )}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-[13.5px] text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <Alert
      tone="danger"
      title={title}
      action={
        onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      {error?.message || 'An unexpected error occurred.'}
    </Alert>
  );
}

export function Switch({ checked, onCheckedChange, id, disabled, ...rest }) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative h-5 w-9 shrink-0 rounded-full border border-line-strong bg-surface-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
      {...rest}
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[17px]" />
    </SwitchPrimitive.Root>
  );
}

export function Tooltip({ content, children }) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-[12px] text-bg shadow">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Kbd({ children }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

/** Monospace identifier (Jira key, file path, model id). */
export function Mono({ className, children }) {
  return <span className={cn('font-mono text-[12.5px]', className)}>{children}</span>;
}

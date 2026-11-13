import { cn } from '../../lib/utils';

const tones = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

export function Badge({ tone = 'neutral', className, children, dot, ...props }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-[1px] text-[12px] font-medium whitespace-nowrap', tones[tone], className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

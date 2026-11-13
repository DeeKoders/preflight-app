import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const variants = {
  primary: 'bg-accent text-accent-ink hover:opacity-90 border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink',
  danger: 'bg-surface text-danger border border-line-strong hover:bg-danger-soft',
  link: 'bg-transparent text-accent underline-offset-4 hover:underline border border-transparent px-0',
};
const sizes = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-8.5 px-3.5 text-[13.5px] gap-2 rounded-md',
  lg: 'h-10 px-4.5 text-sm gap-2 rounded-lg',
  icon: 'h-8 w-8 rounded-md justify-center',
};

export const Button = forwardRef(function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, asChild, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center font-medium whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/** Anchor styled as a button (for external links like "Open in Jira"). */
export function ButtonLink({ variant = 'secondary', size = 'md', className, children, ...props }) {
  return (
    <a className={cn('inline-flex items-center font-medium whitespace-nowrap transition-colors', variants[variant], sizes[size], className)} {...props}>
      {children}
    </a>
  );
}

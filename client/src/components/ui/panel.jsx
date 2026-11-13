import { cn } from '../../lib/utils';

export function Panel({ className, children, ...props }) {
  return (
    <section className={cn('rounded-[10px] border border-line bg-surface', className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, description, actions, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, children }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

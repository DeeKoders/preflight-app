import { forwardRef, useId } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '../../lib/utils';

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-muted',
        'focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/25',
        'aria-[invalid=true]:border-danger disabled:opacity-60',
        className
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }) {
  return <LabelPrimitive.Root className={cn('text-[13px] font-medium text-ink-2', className)} {...props} />;
}

/** Label + control + hint/error, wired up for accessibility. */
export function Field({ label, hint, error, children, className }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {children({ id, 'aria-describedby': describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={`${id}-err`} className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Maps API validation details ({ path, message }[]) to a { field: message } object. */
export const fieldErrors = (error) =>
  Object.fromEntries((Array.isArray(error?.details) ? error.details : []).map((d) => [d.path, d.message]));

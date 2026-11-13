import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

/** options: [{ value, label, hint? }] */
export function Select({ value, onValueChange, options, placeholder = 'Select…', id, className, disabled, 'aria-label': ariaLabel, ...rest }) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={rest['aria-describedby']}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink',
          'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60 data-[placeholder]:text-muted',
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="h-4 w-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer items-center rounded-md py-1.5 pl-7 pr-3 text-[13.5px] outline-none select-none data-[highlighted]:bg-surface-2"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2">
                  <Check className="h-3.5 w-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <div>
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  {o.hint && <div className="text-[12px] text-muted">{o.hint}</div>}
                </div>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

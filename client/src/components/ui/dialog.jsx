import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

const overlay = 'fixed inset-0 z-40 bg-black/40';
const content =
  'fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgba(10,20,30,0.35)] focus:outline-none';

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'max-w-lg' }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlay} />
        <DialogPrimitive.Content className={cn(content, width)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmation for destructive actions. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, loading }) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={overlay} />
        <AlertPrimitive.Content className={cn(content, 'max-w-md p-5')}>
          <AlertPrimitive.Title className="text-[15px] font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className="mt-2 text-[13.5px] text-ink-2">{description}</AlertPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertPrimitive.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertPrimitive.Cancel>
            <Button
              variant="danger"
              loading={loading}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}

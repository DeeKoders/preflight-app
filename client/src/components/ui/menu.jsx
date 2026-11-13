import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils';

export function DropdownMenu({ trigger, children, align = 'end' }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-lg">
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function MenuItem({ className, icon: Icon, children, ...props }) {
  return (
    <Menu.Item className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50', className)} {...props}>
      {Icon && <Icon className="h-4 w-4 text-muted" aria-hidden />}
      {children}
    </Menu.Item>
  );
}

export const MenuSeparator = () => <Menu.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }) => <Menu.Label className="px-2.5 py-1 text-[12px] text-muted">{children}</Menu.Label>;

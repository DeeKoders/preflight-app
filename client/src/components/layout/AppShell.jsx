import { NavLink, Outlet, useNavigate } from 'react-router';
import { Bot, FileText, LayoutGrid, ListTodo, LogOut, Moon, Plug, Sun, SunMoon, UserRound } from 'lucide-react';
import { useLogout, useMe } from '../../hooks/useAuth';
import { useThemeStore } from '../../stores/theme';
import { cn } from '../../lib/utils';
import { APP_NAME } from '../../lib/brand';
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from '../ui/menu';
import { ActiveJobsIndicator } from '../plan/ActiveJobsIndicator';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/tickets', label: 'My Tickets', icon: ListTodo },
  { to: '/plans', label: 'My Plans', icon: FileText },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/ai-settings', label: 'AI Settings', icon: Bot },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

export function Logo({ className }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M8 20.5 24 9l-4.2 15.2-4.4-5.1L8 20.5Z" fill="var(--accent-ink)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
    </div>
  );
}

function ThemeMenuItems() {
  const { theme, setTheme } = useThemeStore();
  const opts = [
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
    ['system', 'System', SunMoon],
  ];
  return opts.map(([value, label, Icon]) => (
    <MenuItem key={value} icon={Icon} onSelect={() => setTheme(value)} className={theme === value ? 'font-semibold' : ''}>
      {label} theme{theme === value ? ' (current)' : ''}
    </MenuItem>
  ));
}

export function AppShell() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 pt-5 pb-6">
          <Logo />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors',
                  isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <ActiveJobsIndicator />
        <div className="border-t border-line p-3">
          <DropdownMenu
            align="start"
            trigger={
              <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink-2">
                  {(user?.name || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{user?.name}</span>
                  <span className="block truncate text-[12px] text-muted">{user?.email}</span>
                </span>
              </button>
            }
          >
            <MenuLabel>Appearance</MenuLabel>
            <ThemeMenuItems />
            <MenuSeparator />
            <MenuItem icon={UserRound} onSelect={() => navigate('/profile')}>
              Profile
            </MenuItem>
            <MenuItem icon={LogOut} onSelect={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}>
              Sign out
            </MenuItem>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact top bar for small screens */}
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
          <Logo />
          <DropdownMenu trigger={<button className="rounded-md border border-line px-2.5 py-1 text-[13px]">Menu</button>}>
            {NAV.map(({ to, label, icon }) => (
              <MenuItem key={to} icon={icon} onSelect={() => navigate(to)}>
                {label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <ThemeMenuItems />
            <MenuSeparator />
            <MenuItem icon={LogOut} onSelect={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}>
              Sign out
            </MenuItem>
          </DropdownMenu>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-end justify-between gap-4 px-6 py-6 md:px-8">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function PageBody({ className, children }) {
  return <div className={cn('mx-auto max-w-[1180px] px-6 py-6 md:px-8', className)}>{children}</div>;
}

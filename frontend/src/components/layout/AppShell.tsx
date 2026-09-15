import type { ReactNode } from 'react';
import type { Theme } from '../../hooks/useTheme';
import type { ConnectionState } from '../../hooks/useSystemMetrics';
import Sidebar, { type NavItem } from './Sidebar';
import TopBar from './TopBar';

interface AppShellProps {
  connection: ConnectionState;
  lastUpdated: number | null;
  theme: Theme;
  onToggleTheme: () => void;
  navItems: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  title: string;
  description?: string;
  topBarAction?: ReactNode;
  children: ReactNode;
}

export default function AppShell({
  connection,
  lastUpdated,
  theme,
  onToggleTheme,
  navItems,
  activeId,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  title,
  description,
  topBarAction,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <Sidebar
        connection={connection}
        lastUpdated={lastUpdated}
        theme={theme}
        onToggleTheme={onToggleTheme}
        items={navItems}
        activeId={activeId}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} description={description} action={topBarAction} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

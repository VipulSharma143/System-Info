import type { ReactNode } from 'react';
import type { Theme } from '../../hooks/useTheme';
import type { ConnectionState } from '../../hooks/useSystemMetrics';
import type { Hue } from '../../lib/hues';
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
  hue: Hue;
  topBarAction?: ReactNode;
  children: ReactNode;
}

export default function AppShell({ title, description, hue, topBarAction, children, ...rail }: AppShellProps) {
  return (
    <div
      className="flex h-screen w-full gap-3 overflow-hidden p-3 text-ink max-md:p-0"
      style={{ background: 'radial-gradient(900px 480px at 12% -8%, var(--bg-glow), transparent 65%), var(--bg)' }}
    >
      <Sidebar
        connection={rail.connection}
        lastUpdated={rail.lastUpdated}
        theme={rail.theme}
        onToggleTheme={rail.onToggleTheme}
        items={rail.navItems}
        activeId={rail.activeId}
        onNavigate={rail.onNavigate}
        collapsed={rail.collapsed}
        onToggleCollapsed={rail.onToggleCollapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} description={description} hue={hue} action={topBarAction} />
        <main className="flex-1 overflow-y-auto max-md:pb-24">{children}</main>
      </div>
    </div>
  );
}

import {
  Activity,
  Cpu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  ListTree,
} from 'lucide-react';
import type { Theme } from '../../hooks/useTheme';
import StatusIndicator from '../common/StatusIndicator';

export interface NavItem {
  id: string;
  label: string;
  count?: number;
}

const ICONS: Record<string, typeof Cpu> = {
  overview: Cpu,
  network: Network,
  processes: ListTree,
  analytics: Activity,
};

interface SidebarProps {
  isLive: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  items: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function Sidebar({
  isLive,
  theme,
  onToggleTheme,
  items,
  activeId,
  onNavigate,
  collapsed,
  onToggleCollapsed,
}: SidebarProps) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200"
      style={{ width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)' }}
    >
      <div className="flex h-12 items-center gap-2 border-b border-[var(--border)] px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent-soft,transparent)]" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}>
          <Activity className="h-3.5 w-3.5 text-[var(--accent)]" strokeWidth={2.2} />
        </span>
        {!collapsed && (
          <span className="truncate text-[13px] font-semibold tracking-tight text-[var(--text)]">
            Signal
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {items.map((item) => {
          const Icon = ICONS[item.id] ?? Cpu;
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.id)}
              className={`group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                active
                  ? 'bg-[var(--surface-hover)] text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity ${
                  active ? 'bg-[var(--accent)] opacity-100' : 'opacity-0'
                }`}
              />
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && item.count !== undefined && (
                <span className="tabular ml-auto rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-faint)]">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-[var(--border)] p-2.5">
        {!collapsed && (
          <div className="px-0.5">
            <StatusIndicator live={isLive} />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {!collapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

import {
  Activity,
  BatteryMedium,
  Cpu,
  Download,
  HardDrive,
  Info,
  ListTree,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from 'lucide-react';
import type { Theme } from '../../hooks/useTheme';
import type { ConnectionState } from '../../hooks/useSystemMetrics';
import StatusIndicator from '../common/StatusIndicator';
import { APP_VERSION } from '../../lib/version';

export interface NavItem {
  id: string;
  label: string;
  count?: number;
  /** Small attention dot (used by the Updates tab when a new version exists). */
  badge?: boolean;
}

const ICONS: Record<string, typeof Cpu> = {
  overview: Cpu,
  analytics: Activity,
  processes: ListTree,
  storage: HardDrive,
  network: Network,
  battery: BatteryMedium,
  system: Info,
  updates: Download,
};

interface SidebarProps {
  connection: ConnectionState;
  lastUpdated: number | null;
  theme: Theme;
  onToggleTheme: () => void;
  items: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function Sidebar({
  connection,
  lastUpdated,
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
      <div
        className={`flex h-12 shrink-0 items-center gap-2.5 border-b border-[var(--border)] ${
          collapsed ? 'justify-center px-2' : 'px-4'
        }`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <Activity className="h-4 w-4 text-[var(--accent)]" strokeWidth={2.2} />
        </span>
        {!collapsed && (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">
              System Info
            </span>
            <span className="tabular shrink-0 text-[10.5px] text-[var(--text-faint)]">
              v{APP_VERSION}
            </span>
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3" aria-label="Sections">
        {items.map((item) => {
          const Icon = ICONS[item.id] ?? Cpu;
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                collapsed ? 'justify-center' : ''
              } ${
                active
                  ? 'bg-[var(--surface-hover)] font-medium text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
              }`}
            >
              <span
                className={`absolute -left-2.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity ${
                  active ? 'bg-[var(--accent)] opacity-100' : 'opacity-0'
                }`}
              />
              <Icon
                className={`h-4 w-4 shrink-0 ${active ? 'text-[var(--accent)]' : ''}`}
                strokeWidth={1.8}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {item.badge && (
                <span
                  title="Update available"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)] ${
                    collapsed ? 'absolute right-2 top-2' : 'ml-auto'
                  }`}
                />
              )}
              {!collapsed && item.count !== undefined && (
                <span className="tabular ml-auto rounded-md border border-[var(--border)] px-1.5 py-px text-[11px] text-[var(--text-faint)]">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2.5 border-t border-[var(--border)] p-2.5">
        {!collapsed && (
          <div className="px-1.5">
            <StatusIndicator connection={connection} lastUpdated={lastUpdated} />
          </div>
        )}
        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] ${
              collapsed ? 'w-8' : 'flex-1'
            }`}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {!collapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

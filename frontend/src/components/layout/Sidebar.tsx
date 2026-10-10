import { memo } from 'react';
import {
  Activity,
  BatteryMedium,
  Cpu,
  Download,
  HardDrive,
  Info,
  LayoutDashboard,
  ListTree,
  MemoryStick,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Gauge,
  Gpu,
  type LucideIcon,
} from 'lucide-react';
import type { Theme } from '../../hooks/useTheme';
import type { ConnectionState } from '../../hooks/useSystemMetrics';
import { hueStyle, type Hue } from '../../lib/hues';
import { APP_VERSION } from '../../lib/version';
import StatusIndicator from '../common/StatusIndicator';
import BrandMark from './BrandMark';

export interface NavItem {
  id: string;
  label: string;
  hue: Hue;
  count?: number;
  /** Attention dot (the Updates tab when a new version exists). */
  badge?: boolean;
}

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  analytics: Activity,
  processes: ListTree,
  cpu: Cpu,
  ram: MemoryStick,
  gpu: Gpu,
  overlay: Gauge,
  storage: HardDrive,
  network: Network,
  battery: BatteryMedium,
  system: Info,
  updates: Download,
};

interface SidebarProps {
  connection: ConnectionState;
  theme: Theme;
  onToggleTheme: () => void;
  items: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/*
  Navigation rail: a floating panel on wide windows, a bottom bar on narrow ones. Each destination
  carries its subsystem hue, so the colour you see in the rail is the colour of that page's charts.
*/
function Sidebar({
  connection,
  theme,
  onToggleTheme,
  items,
  activeId,
  onNavigate,
  collapsed,
  onToggleCollapsed,
}: SidebarProps) {
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <aside
      className={`panel z-20 flex shrink-0 flex-col rounded-[var(--r-xl)] transition-[width] duration-200 max-md:fixed max-md:inset-x-2 max-md:bottom-2 max-md:h-16 max-md:w-auto max-md:flex-row max-md:items-center max-md:rounded-full max-md:px-2 ${
        collapsed ? 'w-[var(--rail-w-collapsed)]' : 'w-[var(--rail-w)]'
      }`}
    >
      <div className={`flex h-16 shrink-0 items-center gap-3 max-md:hidden ${collapsed ? 'justify-center' : 'px-5'}`}>
        <BrandMark />
        {!collapsed && (
          <span className="min-w-0 leading-tight">
            <span className="num block truncate text-[16px] font-semibold text-ink">System Info</span>
            <span className="num block text-[11px] text-faint">v{APP_VERSION}</span>
          </span>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2 max-md:flex max-md:space-y-0 max-md:gap-1 max-md:overflow-x-auto max-md:overflow-y-hidden max-md:py-0" aria-label="Sections">
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
              aria-label={item.label}
              style={hueStyle(item.hue)}
              className={`relative flex h-10 w-full items-center gap-3 rounded-full px-2 text-[13px] transition-colors max-md:w-auto max-md:shrink-0 max-md:px-3 ${collapsed ? 'justify-center' : ''} ${
                active ? 'bg-surface-3 font-semibold text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <span className={`glyph !h-7 !w-7 !rounded-full ${active ? '' : '!bg-transparent'}`}>
                <Icon className="h-4 w-4" strokeWidth={active ? 2.3 : 1.9} />
              </span>
              {!collapsed && <span className="truncate max-md:hidden">{item.label}</span>}
              {item.badge && (
                <span title="Update available" className={`h-2 w-2 shrink-0 rounded-full bg-[var(--h)] ${collapsed ? 'absolute right-2 top-2' : 'ml-auto'}`} />
              )}
              {!collapsed && item.count !== undefined && (
                <span className="num ml-auto rounded-full bg-surface-2 px-2 py-px text-[11px] text-faint max-md:hidden">{item.count}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 p-2.5 max-md:hidden">
        {!collapsed && (
          <div className="px-2">
            <StatusIndicator connection={connection} />
          </div>
        )}
        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className={`flex h-9 items-center justify-center gap-2 rounded-full text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink ${collapsed ? 'w-9' : 'flex-1'}`}
          >
            <ThemeIcon className="h-3.5 w-3.5" />
            {!collapsed && <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default memo(Sidebar);

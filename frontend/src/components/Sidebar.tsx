import type { Theme } from '../hooks/useTheme';

interface NavItem {
  id: string;
  label: string;
  count?: number;
}

interface SidebarProps {
  isLive: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  items: NavItem[];
  activeId: string;
  onNavigate: (id: string) => void;
}

export default function Sidebar({ isLive, theme, onToggleTheme, items, activeId, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className={`status-dot ${isLive ? 'status-dot--live' : 'status-dot--down'}`} />
        <span className="sidebar__title">System Info</span>
      </div>

      <nav className="sidebar__nav">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar__nav-item ${activeId === item.id ? 'is-active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span>{item.label}</span>
            {item.count !== undefined && <span className="sidebar__nav-count">{item.count}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <span className="sidebar__status">{isLive ? 'Live' : 'Disconnected'}</span>
        <button type="button" className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </aside>
  );
}

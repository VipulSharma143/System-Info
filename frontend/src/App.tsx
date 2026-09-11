import { useMemo, useState } from 'react';

import { useSystemMetrics } from './hooks/useSystemMetrics';
import { useTheme } from './hooks/useTheme';
import { useProcessHistory } from './hooks/useProcessHistory';

import AppShell from './components/layout/AppShell';
import type { NavItem } from './components/layout/Sidebar';
import OverviewView from './components/views/OverviewView';
import NetworkView from './components/views/NetworkView';
import ProcessesView from './components/views/ProcessesView';
import AnalyticsView from './components/views/AnalyticsView';
import { OfflineBanner } from './components/common/States';
import StatusIndicator from './components/common/StatusIndicator';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'network', label: 'Network' },
  { id: 'processes', label: 'Processes' },
  { id: 'analytics', label: 'Analytics' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const TITLES: Record<SectionId, { title: string; description: string }> = {
  overview: { title: 'Overview', description: 'System state at a glance' },
  network: { title: 'Network', description: 'Interfaces and connection speed' },
  processes: { title: 'Processes', description: 'Running processes by memory' },
  analytics: { title: 'Analytics', description: 'Trends, stats, and bottleneck history' },
};

function App() {
  const { data, error } = useSystemMetrics();
  const { theme, toggle } = useTheme();
  const { findNearest } = useProcessHistory(data?.cpu.usedPercent, data?.processes);

  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [collapsed, setCollapsed] = useState(false);

  const isLive = !error && data !== null;

  // Views stay mounted at all times and switch via visibility, not
  // conditional rendering — this keeps polling hooks (system metrics,
  // analytics, process history) alive across tab changes instead of
  // re-fetching every time a section is opened.
  const navItems: NavItem[] = useMemo(
    () =>
      SECTIONS.map((section) =>
        section.id === 'processes'
          ? { ...section, count: data?.processes.length ?? 0 }
          : section
      ),
    [data?.processes]
  );

  return (
    <AppShell
      isLive={isLive}
      theme={theme}
      onToggleTheme={toggle}
      navItems={navItems}
      activeId={activeSection}
      onNavigate={(id) => setActiveSection(id as SectionId)}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((c) => !c)}
      title={TITLES[activeSection].title}
      description={TITLES[activeSection].description}
      topBarAction={<StatusIndicator live={isLive} />}
    >
      {error && (
        <div className="p-5 pb-0">
          <OfflineBanner message={error} />
        </div>
      )}

      {!data && !error && (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
          Connecting to backend…
        </div>
      )}

      {data && (
        <>
          <div className={activeSection === 'overview' ? 'block' : 'hidden'}>
            <OverviewView data={data} />
          </div>
          <div className={activeSection === 'network' ? 'block' : 'hidden'}>
            <NetworkView network={data.network} />
          </div>
          <div className={activeSection === 'processes' ? 'block' : 'hidden'}>
            <ProcessesView processes={data.processes} />
          </div>
        </>
      )}

      <div className={activeSection === 'analytics' ? 'block' : 'hidden'}>
        <AnalyticsView findNearest={findNearest} />
      </div>
    </AppShell>
  );
}

export default App;

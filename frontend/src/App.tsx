import { useMemo, useState } from 'react';

import { useSystemMetrics } from './hooks/useSystemMetrics';
import { useSystemInfo } from './hooks/useSystemInfo';
import { useTheme } from './hooks/useTheme';
import { useProcessHistory } from './hooks/useProcessHistory';

import AppShell from './components/layout/AppShell';
import type { NavItem } from './components/layout/Sidebar';
import OverviewView from './components/views/OverviewView';
import AnalyticsView from './components/views/AnalyticsView';
import ProcessesView from './components/views/ProcessesView';
import StorageView from './components/views/StorageView';
import NetworkView from './components/views/NetworkView';
import BatteryView from './components/views/BatteryView';
import SystemView from './components/views/SystemView';

import { OfflineBanner } from './components/common/States';
import StatusIndicator from './components/common/StatusIndicator';
import ServiceControls from './components/layout/ServiceControls';

// Order matters — this is the reading order of the product: what's
// happening now, what happened over time, then the per-subsystem detail
// pages, then static reference information last.
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'processes', label: 'Processes' },
  { id: 'storage', label: 'Storage' },
  { id: 'network', label: 'Network' },
  { id: 'battery', label: 'Battery' },
  { id: 'system', label: 'System' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const TITLES: Record<SectionId, { title: string; description: string }> = {
  overview: { title: 'Overview', description: 'System state at a glance' },
  analytics: { title: 'Analytics', description: 'Trends, stats, and bottleneck history' },
  processes: { title: 'Processes', description: 'Running processes by memory' },
  storage: { title: 'Storage', description: 'Drives, capacity, and usage' },
  network: { title: 'Network', description: 'Interfaces, traffic, and connection speed' },
  battery: { title: 'Battery', description: 'Charge, health, and power draw' },
  system: { title: 'System', description: 'Hardware and operating system information' },
};

function App() {
  const { data, error, connection, lastUpdated } = useSystemMetrics();
  const { info, error: infoError } = useSystemInfo();
  const { theme, toggle } = useTheme();
  const { findNearest } = useProcessHistory(data?.cpu.usedPercent, data?.processes);

  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [collapsed, setCollapsed] = useState(false);

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
      connection={connection}
      lastUpdated={lastUpdated}
      theme={theme}
      onToggleTheme={toggle}
      navItems={navItems}
      activeId={activeSection}
      onNavigate={(id) => setActiveSection(id as SectionId)}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((c) => !c)}
      title={TITLES[activeSection].title}
      description={TITLES[activeSection].description}
      topBarAction={
        <div className="flex items-center gap-4">
          <ServiceControls />
          <StatusIndicator connection={connection} lastUpdated={lastUpdated} />
        </div>
      }
    >
      {/*
        The offline banner shows while the last known data stays on screen.
        Blanking the dashboard on a dropped poll would be worse than showing
        stale numbers clearly labelled as stale — which the header's
        "updated Ns ago" counter does.
      */}
      {error && connection === 'offline' && (
        <div className="px-4 pt-4">
          <OfflineBanner message={error} />
        </div>
      )}

      {!data && !error && (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
          Connecting to backend…
        </div>
      )}

      {/*
        Every view stays mounted and is shown/hidden with CSS rather than
        conditionally rendered. This is load-bearing, not cosmetic: it keeps
        the single polling lifecycle (system metrics, analytics, process
        history) alive across navigation instead of tearing hooks down and
        re-fetching on every tab change. Switching tabs costs zero requests.
      */}
      {data && (
        <>
          <div className={activeSection === 'overview' ? 'block' : 'hidden'}>
            <OverviewView data={data} />
          </div>
          <div className={activeSection === 'processes' ? 'block' : 'hidden'}>
            <ProcessesView processes={data.processes} />
          </div>
          <div className={activeSection === 'storage' ? 'block' : 'hidden'}>
            <StorageView disks={data.disks} />
          </div>
          <div className={activeSection === 'network' ? 'block' : 'hidden'}>
            <NetworkView network={data.network} />
          </div>
          <div className={activeSection === 'battery' ? 'block' : 'hidden'}>
            <BatteryView battery={data.battery} />
          </div>
        </>
      )}

      {/* Analytics and System own their own data sources, so they mount
          regardless of whether the live snapshot has arrived yet. */}
      <div className={activeSection === 'analytics' ? 'block' : 'hidden'}>
        <AnalyticsView findNearest={findNearest} />
      </div>
      <div className={activeSection === 'system' ? 'block' : 'hidden'}>
        <SystemView info={info} infoError={infoError} data={data} />
      </div>
    </AppShell>
  );
}

export default App;

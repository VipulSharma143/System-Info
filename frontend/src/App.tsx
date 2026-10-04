import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';

import { useSystemMetrics } from './hooks/useSystemMetrics';
import { useSystemInfo } from './hooks/useSystemInfo';
import { useSystemGpu } from './hooks/useSystemGpu';
import { useServiceControl } from './hooks/useServiceControl';
import { useTheme } from './hooks/useTheme';
import { useProcessHistory } from './hooks/useProcessHistory';
import { useUpdater } from './hooks/useUpdater';
import { useFailureAlerts } from './hooks/useFailureAlerts';
import { isTauri } from './lib/tauri';

import AppShell from './components/layout/AppShell';
import type { NavItem } from './components/layout/Sidebar';
import StartupScreen, { buildStartupSteps } from './components/layout/StartupScreen';
import OverviewView from './components/views/OverviewView';

// Everything but the first screen is loaded the first time it is opened.
const AnalyticsView = lazy(() => import('./components/views/AnalyticsView'));
const ProcessesView = lazy(() => import('./components/views/ProcessesView'));
const RamView = lazy(() => import('./components/views/RamView'));
const StorageView = lazy(() => import('./components/views/StorageView'));
const NetworkView = lazy(() => import('./components/views/NetworkView'));
const BatteryView = lazy(() => import('./components/views/BatteryView'));
const SystemView = lazy(() => import('./components/views/SystemView'));
const UpdatesView = lazy(() => import('./components/views/UpdatesView'));
const UpdateInstallingOverlay = lazy(() =>
  import('./components/views/UpdatesView').then((m) => ({ default: m.UpdateInstallingOverlay }))
);

import { LoadingState, OfflineBanner } from './components/common/States';
import StatusIndicator from './components/common/StatusIndicator';
import ServiceControls from './components/layout/ServiceControls';
import Button from './components/common/Button';

// Order matters — this is the reading order of the product: what's
// happening now, what happened over time, then the per-subsystem detail
// pages, then static reference information last.
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'processes', label: 'Processes' },
  { id: 'ram', label: 'RAM' },
  { id: 'storage', label: 'Storage' },
  { id: 'network', label: 'Network' },
  { id: 'battery', label: 'Battery' },
  { id: 'system', label: 'System' },
  { id: 'updates', label: 'Updates' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const TITLES: Record<SectionId, { title: string; description: string }> = {
  overview: { title: 'Overview', description: 'System state at a glance' },
  analytics: { title: 'Analytics', description: 'Trends, stats, and bottleneck history' },
  processes: { title: 'Processes', description: 'Running processes by memory' },
  ram: { title: 'RAM', description: 'Memory usage, installed modules, and health' },
  storage: { title: 'Storage', description: 'Drives, capacity, and usage' },
  network: { title: 'Network', description: 'Interfaces, traffic, and connection speed' },
  battery: { title: 'Battery', description: 'Charge, health, and power draw' },
  system: { title: 'System', description: 'Hardware and operating system information' },
  updates: { title: 'Updates', description: 'Check for new versions and read release notes' },
};

// Retrying after a startup failure remounts the whole tree, which gives every hook a fresh
// startup window.
function App() {
  const [startupAttempt, setStartupAttempt] = useState(0);
  return <AppContent key={startupAttempt} onRetryStartup={() => setStartupAttempt((a) => a + 1)} />;
}

function Page({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className={active ? 'block' : 'hidden'}>
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </div>
  );
}

function AppContent({ onRetryStartup }: { onRetryStartup: () => void }) {
  const {
    data,
    error,
    connection,
    lastUpdated,
    startupError: metricsStartupError,
  } = useSystemMetrics();
  const { status: serviceStatus } = useServiceControl();
  const { theme, toggle } = useTheme();
  const { findNearest } = useProcessHistory(data?.cpu.usedPercent, data?.processes);

  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [collapsed, setCollapsed] = useState(false);

  // A page is mounted the first time it is opened and then stays mounted (hidden with CSS), so
  // its polling and state survive navigation, but nothing is fetched for pages never visited.
  const [visited, setVisited] = useState<ReadonlySet<SectionId>>(() => new Set<SectionId>(['overview']));
  const navigate = useCallback((id: SectionId) => {
    setActiveSection(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // Identity and GPU details are only shown on the System page: load them when it is first
  // opened (GPU only while it is on screen) so they are never part of startup.
  const { info, error: infoError, retry: retryInfo } = useSystemInfo(visited.has('system'));
  const { gpus, error: gpuError } = useSystemGpu(activeSection === 'system');

  // One updater instance for the whole app: the sidebar badge, the banner
  // below and the Updates tab all read this same state. Automatic checks only
  // begin once the dashboard has loaded, so they never compete with startup.
  const updater = useUpdater(data !== null);
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null);
  const updateAvailable = updater.phase === 'available' && updater.available !== null;

  const navItems: NavItem[] = useMemo(
    () =>
      SECTIONS.map((section) => {
        if (section.id === 'processes') return { ...section, count: data?.processes.length ?? 0 };
        if (section.id === 'updates') return { ...section, badge: updateAvailable };
        return section;
      }),
    [data?.processes, updateAvailable]
  );

  // Inside the Tauri shell the backend is a child process whose readiness is reported by the
  // services-status event. In a browser it was started before the page loaded.
  const servicesReady = !isTauri() || serviceStatus.backend === 'running';
  const metricsLoaded = data !== null;

  // Startup only waits for the dashboard snapshot. A genuine startup failure exists only before
  // the first successful load; afterwards a disconnect is handled by the offline banner.
  const startupFailed = !metricsLoaded && Boolean(metricsStartupError);

  // Friendly SweetAlert notifications for genuine failures. This only observes
  // the error state the hooks above already produce — no requests, no polling
  // changes. `quiet` covers moments when a dropped connection is expected: the
  // user pressed Stop, services are still starting, or an update is installing.
  useFailureAlerts({
    startupFailed,
    onRetryStartup,
    connection,
    gpuHasError: Boolean(gpuError),
    quiet: updater.phase === 'installing' || (isTauri() && serviceStatus.backend !== 'running'),
  });

  if (!data) {
    return (
      <StartupScreen
        steps={buildStartupSteps({ servicesReady, metricsLoaded })}
        failed={startupFailed}
        onRetry={onRetryStartup}
      />
    );
  }

  return (
    <AppShell
      connection={connection}
      lastUpdated={lastUpdated}
      theme={theme}
      onToggleTheme={toggle}
      navItems={navItems}
      activeId={activeSection}
      onNavigate={(id) => navigate(id as SectionId)}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((c) => !c)}
      title={TITLES[activeSection].title}
      description={TITLES[activeSection].description}
      topBarAction={
        <div className="flex items-center gap-3">
          <ServiceControls />
          {isTauri() && <span aria-hidden="true" className="h-4 w-px bg-[var(--border)]" />}
          <StatusIndicator connection={connection} lastUpdated={lastUpdated} compact />
        </div>
      }
    >
      {/*
        The offline banner shows while the last known data stays on screen.
        Blanking the dashboard on a dropped poll would be worse than showing
        stale numbers clearly labelled as stale — which the header's
        "updated Ns ago" counter does. `error` here is exclusively the
        post-first-load, steady-state signal (see useSystemMetrics) — it can
        no longer fire during the startup window this component gates above.
      */}
      {updateAvailable &&
        updater.available &&
        dismissedBanner !== updater.available.version &&
        activeSection !== 'updates' && (
          <div className="px-4 pt-4">
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border border-[var(--accent)]/30 px-4 py-2 text-[13px] text-[var(--text)]"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
            >
              <span>
                System Info <strong className="font-semibold">v{updater.available.version}</strong> is
                available.
              </span>
              <button
                type="button"
                onClick={() => navigate('updates')}
                className="font-medium text-[var(--accent)] hover:underline"
              >
                View details
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setDismissedBanner(updater.available!.version)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

      {error && connection === 'offline' && updater.phase !== 'installing' && (
        <div className="px-4 pt-4">
          <OfflineBanner />
        </div>
      )}

      <div className={activeSection === 'overview' ? 'block' : 'hidden'}>
        <OverviewView data={data} />
      </div>
      {visited.has('analytics') && (
        <Page active={activeSection === 'analytics'}>
          <AnalyticsView findNearest={findNearest} />
        </Page>
      )}
      {visited.has('processes') && (
        <Page active={activeSection === 'processes'}>
          <ProcessesView processes={data.processes} />
        </Page>
      )}
      {visited.has('ram') && (
        <Page active={activeSection === 'ram'}>
          <RamView active={activeSection === 'ram'} />
        </Page>
      )}
      {visited.has('storage') && (
        <Page active={activeSection === 'storage'}>
          <StorageView disks={data.disks} />
        </Page>
      )}
      {visited.has('network') && (
        <Page active={activeSection === 'network'}>
          <NetworkView network={data.network} />
        </Page>
      )}
      {visited.has('battery') && (
        <Page active={activeSection === 'battery'}>
          <BatteryView battery={data.battery} />
        </Page>
      )}
      {visited.has('system') && (
        <Page active={activeSection === 'system'}>
          <SystemView
            info={info}
            infoError={infoError}
            onRetryInfo={retryInfo}
            data={data}
            gpus={gpus}
            gpuError={gpuError}
          />
        </Page>
      )}
      {visited.has('updates') && (
        <Page active={activeSection === 'updates'}>
          <UpdatesView updater={updater} />
        </Page>
      )}

      {updater.phase === 'installing' && (
        <Suspense fallback={null}>
          <UpdateInstallingOverlay version={updater.available?.version} />
        </Suspense>
      )}
    </AppShell>
  );
}

export default App;
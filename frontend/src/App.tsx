import { useMemo, useState } from 'react';

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
import AnalyticsView from './components/views/AnalyticsView';
import ProcessesView from './components/views/ProcessesView';
import StorageView from './components/views/StorageView';
import NetworkView from './components/views/NetworkView';
import BatteryView from './components/views/BatteryView';
import SystemView from './components/views/SystemView';
import UpdatesView, { UpdateInstallingOverlay } from './components/views/UpdatesView';

import { OfflineBanner } from './components/common/States';
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
  storage: { title: 'Storage', description: 'Drives, capacity, and usage' },
  network: { title: 'Network', description: 'Interfaces, traffic, and connection speed' },
  battery: { title: 'Battery', description: 'Charge, health, and power draw' },
  system: { title: 'System', description: 'Hardware and operating system information' },
  updates: { title: 'Updates', description: 'Check for new versions and read release notes' },
};

// Top-level wrapper only exists to own the "retry after a genuine startup
// failure" mechanism. useSystemMetrics/useSystemGpu don't expose their own
// retry() the way useSystemInfo does — they just poll on a fixed interval —
// so the simplest, most honest way to give them a fresh STARTUP_GRACE_MS
// window on Retry is a full remount: bumping `startupAttempt` changes
// AppContent's key, which discards and re-mounts every hook inside it,
// including a fresh `startedAt` in the two polling hooks.
function App() {
  const [startupAttempt, setStartupAttempt] = useState(0);
  return <AppContent key={startupAttempt} onRetryStartup={() => setStartupAttempt((a) => a + 1)} />;
}

function AppContent({ onRetryStartup }: { onRetryStartup: () => void }) {
  const {
    data,
    error,
    connection,
    lastUpdated,
    startupError: metricsStartupError,
  } = useSystemMetrics();
  const { info, error: infoError, retry: retryInfo } = useSystemInfo();
  const { gpus, error: gpuError, startupError: gpuStartupError } = useSystemGpu();
  const { status: serviceStatus } = useServiceControl();
  const { theme, toggle } = useTheme();
  const { findNearest } = useProcessHistory(data?.cpu.usedPercent, data?.processes);

  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [collapsed, setCollapsed] = useState(false);

  // One updater instance for the whole app: the sidebar badge, the banner
  // below and the Updates tab all read this same state. Automatic checks only
  // begin once the dashboard has loaded, so they never compete with startup.
  const updater = useUpdater(info !== null && data !== null && gpus !== null);
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

  // "Services starting" only means something inside the Tauri desktop
  // shell, where the backend/analytics processes are spawned by this app
  // and their readiness is reported via the real services-status event
  // (useServiceControl). On the Linux browser-tab path, start-all.sh
  // already started all three processes before the page even loaded, so
  // there's no separate "starting services" phase to represent here —
  // treat it as instantly satisfied rather than faking a check.
  const servicesReady = !isTauri() || serviceStatus.backend === 'running';
  const infoLoaded = info !== null;
  const metricsLoaded = data !== null;
  const gpuLoaded = gpus !== null;
  const initialLoadComplete = infoLoaded && metricsLoaded && gpuLoaded;

  // A genuine startup failure only exists before the first successful
  // load — these *StartupError fields are only ever set once
  // STARTUP_GRACE_MS has elapsed with zero success (see the hooks). Once
  // any source has loaded once, a later disconnect is steady-state
  // territory (OfflineBanner / SystemView's own error panels), not this.
  const startupFailed = !initialLoadComplete && Boolean(metricsStartupError || gpuStartupError || infoError);

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

  if (!initialLoadComplete || !data || !info || !gpus) {
    const steps = buildStartupSteps({ servicesReady, infoLoaded, metricsLoaded, gpuLoaded });
    return (
      <StartupScreen
        steps={steps}
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
      onNavigate={(id) => setActiveSection(id as SectionId)}
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
                onClick={() => setActiveSection('updates')}
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

      {/*
        Every view stays mounted and is shown/hidden with CSS rather than
        conditionally rendered. This is load-bearing, not cosmetic: it keeps
        the single polling lifecycle (system metrics, analytics, process
        history) alive across navigation instead of tearing hooks down and
        re-fetching on every tab change. Switching tabs costs zero requests.
      */}
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

      <div className={activeSection === 'analytics' ? 'block' : 'hidden'}>
        <AnalyticsView findNearest={findNearest} />
      </div>
      <div className={activeSection === 'system' ? 'block' : 'hidden'}>
        <SystemView
          info={info}
          infoError={infoError}
          onRetryInfo={retryInfo}
          data={data}
          gpus={gpus}
          gpuError={gpuError}
        />
      </div>
      <div className={activeSection === 'updates' ? 'block' : 'hidden'}>
        <UpdatesView updater={updater} />
      </div>

      {updater.phase === 'installing' && (
        <UpdateInstallingOverlay version={updater.available?.version} />
      )}
    </AppShell>
  );
}

export default App;
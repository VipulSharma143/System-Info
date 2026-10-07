import { Activity, lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';

import { useSystemMetrics } from './hooks/useSystemMetrics';
import { useDashboardHistory } from './hooks/useDashboardHistory';
import { useSystemInfo } from './hooks/useSystemInfo';
import { useSystemGpu } from './hooks/useSystemGpu';
import { useServiceControl } from './hooks/useServiceControl';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useTheme } from './hooks/useTheme';
import { useProcessHistory } from './hooks/useProcessHistory';
import { useUpdater } from './hooks/useUpdater';
import { useFailureAlerts } from './hooks/useFailureAlerts';
import { isTauri } from './lib/tauri';
import { SECTIONS, sectionById, type SectionId } from './lib/sections';

import AppShell from './components/layout/AppShell';
import type { NavItem } from './components/layout/Sidebar';
import ServiceControls from './components/layout/ServiceControls';
import StartupScreen, { buildStartupSteps } from './components/layout/StartupScreen';
import UpdateBanner from './components/layout/UpdateBanner';
import StatusIndicator from './components/common/StatusIndicator';
import { LoadingState, OfflineBanner } from './components/common/States';
import OverviewView from './components/views/OverviewView';

// Everything but the first screen is loaded the first time it is opened.
const AnalyticsView = lazy(() => import('./components/views/AnalyticsView'));
const ProcessesView = lazy(() => import('./components/views/ProcessesView'));
const RamView = lazy(() => import('./components/views/RamView'));
const OverlayView = lazy(() => import('./components/views/OverlayView'));
const GpuView = lazy(() => import('./components/views/GpuView'));
const StorageView = lazy(() => import('./components/views/StorageView'));
const NetworkView = lazy(() => import('./components/views/NetworkView'));
const BatteryView = lazy(() => import('./components/views/BatteryView'));
const SystemView = lazy(() => import('./components/views/SystemView'));
const UpdatesView = lazy(() => import('./components/views/UpdatesView'));
const UpdateInstallingOverlay = lazy(() =>
  import('./components/views/UpdatesView').then((m) => ({ default: m.UpdateInstallingOverlay }))
);

// Retrying after a startup failure remounts the whole tree, which gives every hook a fresh startup window.
function App() {
  const [startupAttempt, setStartupAttempt] = useState(0);
  return <AppContent key={startupAttempt} onRetryStartup={() => setStartupAttempt((a) => a + 1)} />;
}

// A visited page stays mounted so its state survives navigation. While hidden, <Activity> keeps the
// state but pauses its effects (polling stops) and defers its renders, so only the visible page works.
function Page({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <Activity mode={active ? 'visible' : 'hidden'}>
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </Activity>
  );
}

function AppContent({ onRetryStartup }: { onRetryStartup: () => void }) {
  const { data, stale, error, connection, startupError: metricsStartupError } = useSystemMetrics();
  const liveData = stale ? null : data;
  const history = useDashboardHistory(liveData);
  const { status: serviceStatus } = useServiceControl();
  const { theme, toggle } = useTheme();
  const { findNearest } = useProcessHistory(liveData?.cpu.usedPercent, liveData?.processes);

  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [userCollapsed, setUserCollapsed] = useState(false);
  const narrow = useMediaQuery('(max-width: 1100px)');
  const collapsed = userCollapsed || narrow;

  // Pages are mounted the first time they are opened; nothing is fetched for pages never visited.
  const [visited, setVisited] = useState<ReadonlySet<SectionId>>(() => new Set<SectionId>(['overview']));
  const navigate = useCallback((id: SectionId) => {
    setActiveSection(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const onNavigate = useCallback((id: string) => navigate(id as SectionId), [navigate]);
  const toggleCollapsed = useCallback(() => setUserCollapsed((c) => !c), []);

  // Identity and GPU details only appear on the System page: loaded when it is first opened
  // (GPU only while on screen), so they are never part of startup.
  const { info, error: infoError, retry: retryInfo } = useSystemInfo(visited.has('system'));
  const { gpus, error: gpuError } = useSystemGpu(activeSection === 'system');

  // One updater for the whole app: the rail badge, the banner and the Updates tab read the same state.
  // Automatic checks begin only once the dashboard has loaded, so they never compete with startup.
  const updater = useUpdater(liveData !== null);
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null);
  const updateAvailable = updater.phase === 'available' && updater.available !== null;

  const processCount = data?.processes.length ?? 0;
  const navItems: NavItem[] = useMemo(
    () =>
      SECTIONS.map(({ id, label, hue }) => ({
        id,
        label,
        hue,
        ...(id === 'processes' ? { count: processCount } : {}),
        ...(id === 'updates' ? { badge: updateAvailable } : {}),
      })),
    [processCount, updateAvailable]
  );

  // In the desktop shell the backend is a child process whose readiness arrives as an event.
  const servicesReady = !isTauri() || serviceStatus.backend === 'running';
  const metricsLoaded = liveData !== null;
  // A genuine startup failure exists only before the first successful load; afterwards a disconnect
  // is handled by the offline banner.
  const startupFailed = !metricsLoaded && Boolean(metricsStartupError);

  // Friendly alerts for genuine failures. This only observes the hooks' error state; `quiet` covers
  // moments when a dropped connection is expected (Stop pressed, services starting, update installing).
  useFailureAlerts({
    startupFailed,
    onRetryStartup,
    connection,
    gpuHasError: Boolean(gpuError),
    quiet: updater.phase === 'installing' || (isTauri() && serviceStatus.backend !== 'running'),
  });

  if (!data || startupFailed) {
    return (
      <StartupScreen
        steps={buildStartupSteps({ servicesReady, metricsLoaded })}
        failed={startupFailed}
        onRetry={onRetryStartup}
      />
    );
  }

  const section = sectionById(activeSection);
  const show = (id: SectionId, view: ReactNode) =>
    visited.has(id) && (
      <Page active={activeSection === id}>{view}</Page>
    );

  return (
    <AppShell
      connection={connection}
      theme={theme}
      onToggleTheme={toggle}
      navItems={navItems}
      activeId={activeSection}
      onNavigate={onNavigate}
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      title={section.title}
      description={section.description}
      hue={section.hue}
      topBarAction={
        <div className="flex items-center gap-4">
          <ServiceControls />
          <StatusIndicator connection={connection} />
        </div>
      }
    >
      {/* Stale data stays on screen with a clear banner; blanking the dashboard on a dropped poll would be worse. */}
      {updater.available && updateAvailable && dismissedBanner !== updater.available.version && activeSection !== 'updates' && (
        <UpdateBanner
          version={updater.available.version}
          onView={() => navigate('updates')}
          onDismiss={() => setDismissedBanner(updater.available!.version)}
        />
      )}

      {error && connection === 'offline' && updater.phase !== 'installing' && (
        <div className="mx-auto max-w-[1280px] px-6 pb-3.5 max-md:px-4">
          <OfflineBanner />
        </div>
      )}

      <Activity mode={activeSection === 'overview' ? 'visible' : 'hidden'}>
        <OverviewView data={data} history={history} />
      </Activity>
      {show('analytics', <AnalyticsView findNearest={findNearest} />)}
      {show('processes', stale ? <LoadingState /> : <ProcessesView processes={data.processes} />)}
      {show('ram', <RamView active={activeSection === 'ram'} />)}
      {show('gpu', <GpuView active={activeSection === 'gpu'} />)}
      {show('overlay', <OverlayView active={activeSection === 'overlay'} />)}
      {show('storage', <StorageView disks={data.disks} />)}
      {show('network', <NetworkView network={data.network} history={history} />)}
      {show('battery', <BatteryView battery={data.battery} chargeHistory={history.charge} />)}
      {show(
        'system',
        <SystemView info={info} infoError={infoError} onRetryInfo={retryInfo} data={data} gpus={gpus} gpuError={gpuError} />
      )}
      {show('updates', <UpdatesView updater={updater} />)}

      {updater.phase === 'installing' && (
        <Suspense fallback={null}>
          <UpdateInstallingOverlay version={updater.available?.version} />
        </Suspense>
      )}
    </AppShell>
  );
}

export default App;

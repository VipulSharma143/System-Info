import { useEffect, useMemo, useRef, useState } from 'react';

import { useSystemMetrics } from './hooks/useSystemMetrics';
import { useTheme } from './hooks/useTheme';
import { useProcessHistory } from './hooks/useProcessHistory';

import Sidebar from './components/Sidebar';
import MetricHero from './components/MetricHero';
import DiskTable from './components/DiskTable';
import NetworkTable from './components/NetworkTable';
import ProcessTable from './components/ProcessTable';
import AnalyticsPanel from './components/AnalyticsPanel';
import SpeedTestCard from './components/SpeedTestCard';

import './dashboard.css';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'processes', label: 'Processes' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function App() {
  const { data, error } = useSystemMetrics();
  const { theme, toggle } = useTheme();

  const { findNearest } = useProcessHistory(
    data?.cpu.usedPercent,
    data?.processes
  );

  const [activeSection, setActiveSection] =
    useState<SectionId>('overview');

  const isNavigating = useRef(false);

  const sectionRefs = useRef<
    Record<SectionId, HTMLElement | null>
  >({
    overview: null,
    analytics: null,
    processes: null,
  });

  /*
   * Keep every section mounted.
   *
   * Navigation only changes scroll position. This prevents components
   * and their hooks from being recreated when the user changes sections.
   */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (isNavigating.current) {
          return;
        }

        const visibleSections = entries.filter(
          (entry) => entry.isIntersecting
        );

        if (visibleSections.length === 0) {
          return;
        }

        const topMost = visibleSections.reduce((current, entry) =>
          entry.boundingClientRect.top <
          current.boundingClientRect.top
            ? entry
            : current
        );

        const sectionId = topMost.target.id as SectionId;

        if (sectionId) {
          setActiveSection(sectionId);
        }
      },
      {
        rootMargin: '-15% 0px -70% 0px',
        threshold: 0,
      }
    );

    Object.values(sectionRefs.current).forEach((section) => {
      if (section) {
        observer.observe(section);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * Navigation data is derived from the current process count.
   * Everything else is static.
   */
  const navItems = useMemo(
    () =>
      SECTIONS.map((section) =>
        section.id === 'processes'
          ? {
              ...section,
              count: data?.processes.length ?? 0,
            }
          : section
      ),
    [data?.processes.length]
  );

  const setSectionRef =
    (id: SectionId) => (element: HTMLElement | null) => {
      sectionRefs.current[id] = element;
    };

  const handleNavigate = (id: string) => {
    if (!sectionRefs.current[id as SectionId]) {
      return;
    }

    const sectionId = id as SectionId;

    isNavigating.current = true;
    setActiveSection(sectionId);

    sectionRefs.current[sectionId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });

    window.setTimeout(() => {
      isNavigating.current = false;
    }, 600);
  };

  const isLive = !error && data !== null;

  return (
    <div className="app-layout">
      <Sidebar
        isLive={isLive}
        theme={theme}
        onToggleTheme={toggle}
        items={navItems}
        activeId={activeSection}
        onNavigate={handleNavigate}
      />

      <main className="app-main">
        {error && (
          <div className="error-banner" role="alert">
            Error: {error}
          </div>
        )}

        {/* Overview */}
        <section
          id="overview"
          ref={setSectionRef('overview')}
          className="view-section"
        >
          {data && (
            <>
              <MetricHero
                cpu={data.cpu}
                ram={data.ram}
              />

              <div className="panel-row">
                <DiskTable disks={data.disks} />
                <NetworkTable network={data.network} />
              </div>

              <SpeedTestCard />
            </>
          )}
        </section>

        {/* Analytics */}
        <section
          id="analytics"
          ref={setSectionRef('analytics')}
          className="view-section"
        >
          <AnalyticsPanel findNearest={findNearest} />
        </section>

        {/* Processes */}
        <section
          id="processes"
          ref={setSectionRef('processes')}
          className="view-section"
        >
          {data && (
            <ProcessTable processes={data.processes} />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
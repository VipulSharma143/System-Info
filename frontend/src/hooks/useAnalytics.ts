import { useCallback, useEffect, useState } from 'react';
import type { BottlenecksResponse, StatsResponse, TrendResponse } from '../types/analytics';
import { API_BASE } from '../lib/apiConfig';

const DEFAULT_WINDOW_MINUTES = 60;
const POLL_INTERVAL_MS = 10_000; // analytics is a rolling-window aggregate,
// not a live-tick value, so this polls slower than the 2s system-metrics loop

interface AnalyticsState {
  trend: TrendResponse | null;
  bottlenecks: BottlenecksResponse | null;
  stats: StatsResponse | null;
  unavailable: boolean; // Python analytics service down/unreachable — mirrors
  // the graceful-degradation pattern already used for hardware reads
  loading: boolean;
}

// windowMinutes is driven by the Analytics page's range selector. Changing
// it re-runs the effect below (fetchAnalytics depends on it), which swaps
// the polling loop over to the new range — it does NOT add a second loop.
export function useAnalytics(windowMinutes: number = DEFAULT_WINDOW_MINUTES) {
  const [state, setState] = useState<AnalyticsState>({
    trend: null,
    bottlenecks: null,
    stats: null,
    unavailable: false,
    loading: true,
  });

  const fetchAnalytics = useCallback(async () => {
    const params = `minutes=${windowMinutes}`;

    try {
      const [trendRes, bottlenecksRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/analytics/trend?${params}`),
        fetch(`${API_BASE}/api/analytics/bottlenecks?${params}`),
        fetch(`${API_BASE}/api/analytics/stats?${params}`),
      ]);

      // AnalyticsEndpoints.cs returns 503 when the Python service is
      // unreachable — treat that as "unavailable", not an error state.
      if (trendRes.status === 503 || bottlenecksRes.status === 503 || statsRes.status === 503) {
        setState((prev) => ({ ...prev, unavailable: true, loading: false }));
        return;
      }

      if (!trendRes.ok || !bottlenecksRes.ok || !statsRes.ok) {
        throw new Error('Analytics service returned an unexpected error');
      }

      const [trend, bottlenecks, stats] = await Promise.all([
        trendRes.json() as Promise<TrendResponse>,
        bottlenecksRes.json() as Promise<BottlenecksResponse>,
        statsRes.json() as Promise<StatsResponse>,
      ]);

      setState({ trend, bottlenecks, stats, unavailable: false, loading: false });
    } catch {
      // Network-level failure (service not running at all) gets the same
      // "unavailable" treatment as an explicit 503 from the proxy.
      setState((prev) => ({ ...prev, unavailable: true, loading: false }));
    }
  }, [windowMinutes]);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  return state;
}

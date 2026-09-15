// Types for /api/analytics/* — trend and stats shapes are confirmed against
// real responses. BottleneckEpisode fields are optional + indexable because
// isolated_cpu_spikes objects don't share sustained-episode field names
// (confirmed by the "Invalid Date" bug this caused) — exact shape TBD.

export type TrendDirection = 'climbing' | 'dropping' | 'flat';

export interface DirectionalTrend {
  direction: TrendDirection;
  per_minute: number;
}

// IMPORTANT: analytics_service.py short-circuits with
//   { "message": "no snapshots found in requested window", "count": 0 }
// when the requested window contains no history — cpu_trend and
// network_trend_rx are absent entirely in that case. That is the NORMAL
// state for a fresh install (local storage starts empty), not an error, so
// these are optional and every consumer must handle them being missing.
export interface TrendResponse {
  count: number;
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
  message?: string;
  cpu_trend?: DirectionalTrend;
  network_trend_rx?: Record<string, DirectionalTrend>; // keyed by interface name
}

export type BottleneckClassification = 'cpu_bound' | 'combined_load';

// Confirmed shape for sustained_cpu_episodes / sustained_network_episodes.
// isolated_cpu_spikes entries are NOT guaranteed to match this — every
// field is optional and the index signature allows unknown fields through
// so the UI degrades gracefully instead of guessing wrong again.
export interface BottleneckEpisode {
  start?: string;
  end?: string;
  duration_sec?: number;
  peak?: number;
  samples?: number;
  classification?: BottleneckClassification;
  [key: string]: unknown;
}

export interface BottlenecksResponse {
  count: number;
  from?: string;
  to?: string;
  message?: string;
  sustained_cpu_episodes?: BottleneckEpisode[];
  sustained_network_episodes?: BottleneckEpisode[];
  isolated_cpu_spikes?: BottleneckEpisode[];
  summary?: {
    sustained_cpu_episode_count: number;
    sustained_network_episode_count: number;
    isolated_cpu_spike_count: number;
  };
}

export interface StatSummary {
  mean: number;
  min: number;
  max: number;
  n: number;
}

export interface NetworkStat {
  rx_kbps: StatSummary;
  tx_kbps: StatSummary;
}

// Same empty-window short-circuit as TrendResponse above — on a fresh
// install cpu_percent/network simply aren't present.
export interface StatsResponse {
  count: number;
  from?: string;
  to?: string;
  message?: string;
  cpu_percent?: StatSummary;
  network?: Record<string, NetworkStat>; // keyed by interface name
}

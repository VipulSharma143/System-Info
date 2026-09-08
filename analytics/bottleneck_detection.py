#!/usr/bin/env python3
"""
bottleneck_detection.py

Place this in: ./analytics/bottleneck_detection.py

Third milestone for Phase 7. Goes beyond a flat "CPU > 85% = bottleneck"
check by combining three signals:

1. SUSTAINED high usage — N consecutive samples above a threshold, not
   just one noisy spike. This is what actually matters for "is the system
   struggling" vs "one sample happened to catch a burst".
2. SPIKES — short, isolated jumps above a higher threshold. Reported
   separately from sustained load because they usually mean something
   different (a brief task, not an ongoing bottleneck).
3. CLASSIFICATION per sustained episode — using CPU and network together
   to label *what kind* of bottleneck it looks like:
     - "cpu-bound"     : CPU sustained high, network not correlated
     - "network-bound" : network sustained high, CPU comparatively idle
     - "combined load"    : both sustained high at the same time
     - "idle"          : neither

All thresholds are CLI flags with defaults noted below — defaults are
starting points for a Celeron 1017U dev laptop, not universal truths.
Adjust them once you've watched this against a few real runs.

Every episode found gets printed with its start/end time, duration, and
peak value — think of this as a first pass "what happened and when" log,
not a final report format.

Usage:
    python3 analytics/bottleneck_detection.py --file backend/SystemMonitor.Api/data/snapshots.jsonl
    python3 analytics/bottleneck_detection.py --file backend/SystemMonitor.Api/data/snapshots.jsonl \\
        --cpu-sustained-threshold 85 --cpu-sustained-min-samples 5 \\
        --cpu-spike-threshold 95 --net-sustained-threshold-kbps 500

NOTE: RAM/disk are NOT currently logged by SnapshotLogger.cs (it only logs
what the background service samples: CPU + network). If you want RAM/disk
bottleneck detection, that means extending the logger to also call
GetRamAsync()/GetDisks() — a deliberate scope decision, not done here.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="Detect and classify CPU/network bottleneck episodes.")
    p.add_argument("--file", required=True, help="Path to snapshots.jsonl")
    p.add_argument("--minutes", type=float, default=None,
                    help="Only analyze the last N minutes (default: all data)")

    p.add_argument("--cpu-sustained-threshold", type=float, default=85.0,
                    help="CPU%% level that counts as 'high' for sustained detection (default: 85)")
    p.add_argument("--cpu-sustained-min-samples", type=int, default=5,
                    help="Consecutive samples above threshold to count as sustained (default: 5)")
    p.add_argument("--cpu-spike-threshold", type=float, default=95.0,
                    help="CPU%% level that counts as a spike on its own (default: 95)")

    p.add_argument("--net-sustained-threshold-kbps", type=float, default=500.0,
                    help="Combined RX+TX KB/s across interfaces that counts as 'high' network (default: 500)")
    p.add_argument("--net-sustained-min-samples", type=int, default=5,
                    help="Consecutive samples above network threshold to count as sustained (default: 5)")

    p.add_argument("--skip-first", type=int, default=10,
                    help="Skip the first N samples (startup transient, e.g. first-read CPU spike). Default: 10")

    return p.parse_args()


def load_snapshots(path: Path, since):
    snapshots = []
    with path.open("r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts_raw = record.get("timestamp")
            try:
                ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except Exception:
                continue
            if since is not None and ts < since:
                continue
            snapshots.append((ts, record))
    return snapshots


def total_network_kbps(record):
    total = 0.0
    for entry in (record.get("network") or []):
        total += (entry.get("rxKBps") or 0) + (entry.get("txKBps") or 0)
    return total


def find_sustained_episodes(timestamps, values, threshold, min_samples):
    """
    Find runs of >= min_samples consecutive samples where value >= threshold.
    Returns list of dicts: {start_idx, end_idx, start_ts, end_ts, peak, duration_sec}
    """
    episodes = []
    run_start = None

    for i, v in enumerate(values):
        above = v is not None and v >= threshold
        if above and run_start is None:
            run_start = i
        elif not above and run_start is not None:
            run_len = i - run_start
            if run_len >= min_samples:
                episodes.append(_build_episode(timestamps, values, run_start, i - 1))
            run_start = None

    if run_start is not None:
        run_len = len(values) - run_start
        if run_len >= min_samples:
            episodes.append(_build_episode(timestamps, values, run_start, len(values) - 1))

    return episodes


def _build_episode(timestamps, values, start_idx, end_idx):
    chunk = [v for v in values[start_idx:end_idx + 1] if v is not None]
    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "start_ts": timestamps[start_idx],
        "end_ts": timestamps[end_idx],
        "duration_sec": (timestamps[end_idx] - timestamps[start_idx]).total_seconds(),
        "peak": max(chunk) if chunk else None,
        "samples": end_idx - start_idx + 1,
    }


def find_spikes(timestamps, values, spike_threshold, sustained_indices):
    """
    Single-sample (or short, sub-min-samples) jumps above spike_threshold that
    are NOT already part of a sustained episode. Reported as isolated events.
    """
    spikes = []
    for i, v in enumerate(values):
        if v is not None and v >= spike_threshold and i not in sustained_indices:
            spikes.append((timestamps[i], v))
    return spikes


def indices_in_episodes(episodes):
    s = set()
    for ep in episodes:
        for i in range(ep["start_idx"], ep["end_idx"] + 1):
            s.add(i)
    return s


def classify_episode(cpu_episode, net_values, timestamps, net_threshold):
    """Given a CPU sustained episode, check whether network was also high
    during the same window, to classify cpu-bound vs combined load."""
    start, end = cpu_episode["start_idx"], cpu_episode["end_idx"]
    net_chunk = [v for v in net_values[start:end + 1] if v is not None]
    net_high_fraction = (
        sum(1 for v in net_chunk if v >= net_threshold) / len(net_chunk)
        if net_chunk else 0
    )
    if net_high_fraction >= 0.5:
        return "combined load (CPU + network both high)"
    return "cpu-bound"


def fmt_ts(ts):
    return ts.strftime("%H:%M:%S")


def main():
    args = parse_args()
    path = Path(args.file)
    if not path.exists():
        print(f"[error] file not found: {path}", file=sys.stderr)
        sys.exit(1)

    since = None
    if args.minutes is not None:
        since = datetime.now(timezone.utc) - timedelta(minutes=args.minutes)

    snapshots = load_snapshots(path, since)
    if len(snapshots) <= args.skip_first:
        print(f"Not enough data after skipping first {args.skip_first} samples.")
        sys.exit(0)

    snapshots = snapshots[args.skip_first:]
    timestamps = [ts for ts, _ in snapshots]
    cpu_values = [rec.get("cpuUsedPercent") for _, rec in snapshots]
    net_values = [total_network_kbps(rec) for _, rec in snapshots]

    print(f"Analyzing {len(snapshots)} samples "
          f"({fmt_ts(timestamps[0])} to {fmt_ts(timestamps[-1])}), "
          f"skipped first {args.skip_first} as startup transient.\n")

    # --- Sustained CPU episodes ---
    cpu_episodes = find_sustained_episodes(
        timestamps, cpu_values,
        args.cpu_sustained_threshold, args.cpu_sustained_min_samples
    )
    cpu_sustained_indices = indices_in_episodes(cpu_episodes)

    # --- Sustained network episodes (for context, not double-reporting) ---
    net_episodes = find_sustained_episodes(
        timestamps, net_values,
        args.net_sustained_threshold_kbps, args.net_sustained_min_samples
    )

    print(f"=== Sustained CPU episodes (>= {args.cpu_sustained_threshold}% for "
          f">= {args.cpu_sustained_min_samples} consecutive samples) ===")
    if not cpu_episodes:
        print("  None found.")
    for ep in cpu_episodes:
        classification = classify_episode(ep, net_values, timestamps, args.net_sustained_threshold_kbps)
        print(f"  {fmt_ts(ep['start_ts'])} -> {fmt_ts(ep['end_ts'])} "
              f"({ep['duration_sec']:.1f}s, {ep['samples']} samples, peak {ep['peak']:.1f}%) "
              f"-> {classification}")

    print(f"\n=== Sustained network episodes (>= {args.net_sustained_threshold_kbps} KB/s combined for "
          f">= {args.net_sustained_min_samples} consecutive samples) ===")
    if not net_episodes:
        print("  None found.")
    for ep in net_episodes:
        print(f"  {fmt_ts(ep['start_ts'])} -> {fmt_ts(ep['end_ts'])} "
              f"({ep['duration_sec']:.1f}s, {ep['samples']} samples, peak {ep['peak']:.1f} KB/s)")

    # --- CPU spikes not already part of a sustained episode ---
    spikes = find_spikes(timestamps, cpu_values, args.cpu_spike_threshold, cpu_sustained_indices)
    print(f"\n=== Isolated CPU spikes (>= {args.cpu_spike_threshold}%, not part of a sustained episode) ===")
    if not spikes:
        print("  None found.")
    for ts, v in spikes:
        print(f"  {fmt_ts(ts)}  {v:.1f}%")

    # --- Summary ---
    print("\n=== Summary ===")
    if not cpu_episodes and not net_episodes and not spikes:
        print("  System looks healthy for this window — no sustained load or notable spikes.")
    else:
        print(f"  {len(cpu_episodes)} sustained CPU episode(s), "
              f"{len(net_episodes)} sustained network episode(s), "
              f"{len(spikes)} isolated CPU spike(s).")


if __name__ == "__main__":
    main()

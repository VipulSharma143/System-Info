#!/usr/bin/env python3
"""
trend_analysis.py

Place this in: ./analytics/trend_analysis.py  (same folder as analyze_snapshots.py)

Second milestone for Phase 7. Adds two things analyze_snapshots.py doesn't do:

1. Rolling mean — smooths out short spikes so you can see the underlying
   shape of usage over time, not just point-in-time noise.
2. Linear trend (least-squares slope) — is CPU/network climbing, dropping,
   or flat over the analyzed window? Reported as "% change per minute".

Phase 9 addition: battery drain trend, reusing the exact same rolling-mean/
linear-trend functions already proven on CPU and network above — no new
math needed. Two series tracked: charge percentage (is it draining faster
than usual?) and power draw in watts (is something pulling more current
than normal?). Battery is optional per-snapshot (desktops, or machines
where GetBattery() reported Available: false, simply won't have the field)
so it's skipped gracefully rather than crashing the whole analysis.

No external dependencies (no numpy/pandas) — pure Python standard library,
since analyze_snapshots.py proved the data pipeline without needing them.
If you already have pandas installed and want to switch later, this can be
rewritten shorter with pandas' .rolling() — not necessary yet.

Usage (from project root):
    python3 analytics/trend_analysis.py --file backend/SystemMonitor.Api/data/snapshots.jsonl
    python3 analytics/trend_analysis.py --file backend/SystemMonitor.Api/data/snapshots.jsonl --minutes 15 --window 20

--window is the rolling-mean window size, in NUMBER OF SAMPLES (not seconds),
since your background loop's sampling cadence isn't fixed (~200-500ms per
your own measurements, varies with load). Default 20 samples ≈ last ~10-15s
at typical cadence.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="Rolling mean + trend analysis of snapshot log.")
    p.add_argument("--file", required=True, help="Path to snapshots.jsonl")
    p.add_argument("--minutes", type=float, default=None,
                    help="Only analyze the last N minutes (default: all data)")
    p.add_argument("--window", type=int, default=20,
                    help="Rolling mean window size, in samples (default: 20)")
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


def rolling_mean(values, window):
    """Simple trailing rolling mean. Returns a list same length as values,
    with early entries averaged over however many samples are available."""
    result = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        chunk = [v for v in values[start:i + 1] if v is not None]
        result.append(sum(chunk) / len(chunk) if chunk else None)
    return result


def linear_trend_slope(timestamps, values):
    """
    Least-squares slope of values against elapsed seconds since the first
    timestamp. Returns slope in units-per-second, or None if not computable
    (fewer than 2 valid points, or all timestamps identical).
    """
    points = [(t, v) for t, v in zip(timestamps, values) if v is not None]
    if len(points) < 2:
        return None

    t0 = points[0][0]
    xs = [(t - t0).total_seconds() for t, _ in points]
    ys = [v for _, v in points]

    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n

    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denominator = sum((x - mean_x) ** 2 for x in xs)

    if denominator == 0:
        return None

    return numerator / denominator


def describe_trend(slope_per_sec, unit_label):
    if slope_per_sec is None:
        return "not enough data to compute a trend"

    slope_per_min = slope_per_sec * 60
    direction = "flat"
    if slope_per_min > 0.5:
        direction = "climbing"
    elif slope_per_min < -0.5:
        direction = "dropping"

    return f"{direction} ({slope_per_min:+.2f} {unit_label}/min)"


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
    if not snapshots:
        print("No snapshots found in the requested window.")
        sys.exit(0)

    timestamps = [ts for ts, _ in snapshots]
    cpu_values = [rec.get("cpuUsedPercent") for _, rec in snapshots]

    window_desc = f"last {args.minutes} min" if args.minutes else "all time"
    print(f"Analyzed {len(snapshots)} snapshots ({window_desc}), "
          f"from {timestamps[0]} to {timestamps[-1]}\n")

    # --- CPU trend ---
    cpu_slope = linear_trend_slope(timestamps, cpu_values)
    print("CPU trend:")
    print(f"  {describe_trend(cpu_slope, '%')}")

    cpu_rolling = rolling_mean(cpu_values, args.window)
    valid_rolling = [v for v in cpu_rolling if v is not None]
    if valid_rolling:
        print(f"  Rolling mean (window={args.window} samples): "
              f"starts at {valid_rolling[0]:.1f}%, ends at {valid_rolling[-1]:.1f}%")

    # --- Per-interface network trend (rx only, tx is usually mirror-ish) ---
    print("\nNetwork trend (RX, per interface):")
    ifaces = set()
    for _, rec in snapshots:
        for entry in (rec.get("network") or []):
            ifaces.add(entry.get("iface", "unknown"))

    for iface in sorted(ifaces):
        rx_values = []
        for _, rec in snapshots:
            entry = next((e for e in (rec.get("network") or [])
                          if e.get("iface") == iface), None)
            rx_values.append(entry.get("rxKBps") if entry else None)

        slope = linear_trend_slope(timestamps, rx_values)
        print(f"  {iface}: {describe_trend(slope, 'KB/s')}")

    # --- Battery trend (Phase 9) ---
    # Optional per snapshot: skipped entirely if no snapshot in the window
    # has a "battery" field at all (desktop, or GetBattery() reported
    # Available: false at the time — SnapshotLogger only writes the field
    # when Available is true, so its absence here is itself meaningful,
    # not a bug).
    battery_present_anywhere = any(rec.get("battery") for _, rec in snapshots)

    if not battery_present_anywhere:
        print("\nBattery trend: no battery data in this window "
              "(desktop, or no battery detected during sampling)")
    else:
        capacity_values = [
            (rec.get("battery") or {}).get("capacityPercent")
            for _, rec in snapshots
        ]
        power_values = [
            (rec.get("battery") or {}).get("powerWatts")
            for _, rec in snapshots
        ]

        # -1 is the "unavailable" sentinel used on the C++/C# side
        # (see get_battery_info_json / BatteryInfo) — treat it as missing,
        # same as None, so it doesn't skew the slope.
        capacity_values = [v if v is not None and v >= 0 else None for v in capacity_values]
        power_values = [v if v is not None and v >= 0 else None for v in power_values]

        print("\nBattery trend:")

        capacity_slope = linear_trend_slope(timestamps, capacity_values)
        print(f"  Charge level: {describe_trend(capacity_slope, '%')}")
        if capacity_slope is not None and capacity_slope < 0:
            # Slope is %/sec and negative while discharging — convert to a
            # plain-language "time to empty at current rate" estimate.
            latest_capacity = next((v for v in reversed(capacity_values) if v is not None), None)
            if latest_capacity is not None:
                seconds_to_empty = latest_capacity / (-capacity_slope)
                hours_to_empty = seconds_to_empty / 3600
                print(f"  Estimated time to empty at current drain rate: "
                      f"{hours_to_empty:.1f} hours")

        capacity_rolling = rolling_mean(capacity_values, args.window)
        valid_capacity_rolling = [v for v in capacity_rolling if v is not None]
        if valid_capacity_rolling:
            print(f"  Rolling mean charge (window={args.window} samples): "
                  f"starts at {valid_capacity_rolling[0]:.1f}%, "
                  f"ends at {valid_capacity_rolling[-1]:.1f}%")

        power_slope = linear_trend_slope(timestamps, power_values)
        print(f"  Power draw: {describe_trend(power_slope, 'W')}")

        valid_power = [v for v in power_values if v is not None]
        if valid_power:
            avg_power = sum(valid_power) / len(valid_power)
            print(f"  Average power draw over window: {avg_power:.1f} W")

        # Health % doesn't have a meaningful short-window "trend" — it's a
        # slow, monthly-scale decline, not something that moves visibly
        # across a 10-15 second sampling window. Report the latest known
        # value instead of computing a misleading slope on noise.
        latest_health = next(
            (rec.get("battery", {}).get("healthPercent")
             for _, rec in reversed(snapshots)
             if rec.get("battery") and rec["battery"].get("healthPercent") is not None
             and rec["battery"].get("healthPercent", -1) >= 0),
            None
        )
        if latest_health is not None:
            print(f"  Battery health (design vs current full-charge capacity): "
                  f"{latest_health:.1f}%")


if __name__ == "__main__":
    main()
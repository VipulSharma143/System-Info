#!/usr/bin/env python3
"""
analytics_service.py

Place this in: ./analytics/analytics_service.py

Fourth milestone for Phase 7. Wraps the three proven analysis scripts
(analyze_snapshots.py, trend_analysis.py, bottleneck_detection.py) as a
small FastAPI service, so the .NET backend can call this instead of you
running scripts by hand.

This does NOT replace those scripts — they're still useful standalone for
quick command-line checks. This file re-implements the same logic as
importable functions and exposes them over HTTP. Kept in one file for now
rather than importing across three separate CLI scripts, to avoid
argparse/__main__ complications; if this grows, splitting into a shared
lib.py + api.py is the natural next refactor (not needed yet).

SETUP (run once):
    pip install fastapi uvicorn

RUN:
    cd analytics
    uvicorn analytics_service:app --reload --port 8001

Then test in your browser or with curl:
    http://localhost:8001/health
    http://localhost:8001/stats?file=../backend/SystemMonitor.Api/data/snapshots.jsonl
    http://localhost:8001/trend?file=../backend/SystemMonitor.Api/data/snapshots.jsonl
    http://localhost:8001/bottlenecks?file=../backend/SystemMonitor.Api/data/snapshots.jsonl

FastAPI also auto-generates interactive docs at:
    http://localhost:8001/docs

NOTE on the `file` query param: passed explicitly rather than hardcoded,
since dev-mode paths differ by how you run things. Once this is stable,
consider hardcoding a default path (or reading it from an env var / a
small config file) so .NET doesn't need to know the path at all — not
done here since you're still verifying this by hand first.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query

app = FastAPI(title="System Monitor Analytics", version="0.1.0")


# ---------------------------------------------------------------------------
# Shared loading logic (same as the three CLI scripts)
# ---------------------------------------------------------------------------

def load_snapshots(path: Path, since: Optional[datetime]):
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"file not found: {path}")

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


def resolve_since(minutes: Optional[float]):
    if minutes is None:
        return None
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# /stats  (same as analyze_snapshots.py)
# ---------------------------------------------------------------------------

@app.get("/stats")
def stats(
    file: str = Query(..., description="Path to snapshots.jsonl"),
    minutes: Optional[float] = Query(None, description="Only analyze the last N minutes"),
):
    snapshots = load_snapshots(Path(file), resolve_since(minutes))
    if not snapshots:
        return {"message": "no snapshots found in requested window", "count": 0}

    cpu_vals = [rec.get("cpuUsedPercent") for _, rec in snapshots if rec.get("cpuUsedPercent") is not None]

    rx_by_iface: dict = {}
    tx_by_iface: dict = {}
    for _, rec in snapshots:
        for entry in (rec.get("network") or []):
            iface = entry.get("iface", "unknown")
            rx_by_iface.setdefault(iface, []).append(entry.get("rxKBps"))
            tx_by_iface.setdefault(iface, []).append(entry.get("txKBps"))

    def summarize(values):
        values = [v for v in values if v is not None]
        if not values:
            return None
        return {
            "mean": round(sum(values) / len(values), 2),
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "n": len(values),
        }

    return {
        "count": len(snapshots),
        "from": snapshots[0][0].isoformat(),
        "to": snapshots[-1][0].isoformat(),
        "cpu_percent": summarize(cpu_vals),
        "network": {
            iface: {
                "rx_kbps": summarize(rx_by_iface.get(iface, [])),
                "tx_kbps": summarize(tx_by_iface.get(iface, [])),
            }
            for iface in rx_by_iface
        },
    }


# ---------------------------------------------------------------------------
# /trend  (same as trend_analysis.py)
# ---------------------------------------------------------------------------

def linear_trend_slope(timestamps, values):
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


def describe_trend(slope_per_sec):
    if slope_per_sec is None:
        return {"direction": "unknown", "per_minute": None}
    slope_per_min = slope_per_sec * 60
    direction = "flat"
    if slope_per_min > 0.5:
        direction = "climbing"
    elif slope_per_min < -0.5:
        direction = "dropping"
    return {"direction": direction, "per_minute": round(slope_per_min, 2)}


@app.get("/trend")
def trend(
    file: str = Query(..., description="Path to snapshots.jsonl"),
    minutes: Optional[float] = Query(None, description="Only analyze the last N minutes"),
    window: int = Query(20, description="Rolling mean window size in samples"),
):
    snapshots = load_snapshots(Path(file), resolve_since(minutes))
    if not snapshots:
        return {"message": "no snapshots found in requested window", "count": 0}

    timestamps = [ts for ts, _ in snapshots]
    cpu_values = [rec.get("cpuUsedPercent") for _, rec in snapshots]

    cpu_trend = describe_trend(linear_trend_slope(timestamps, cpu_values))

    ifaces = set()
    for _, rec in snapshots:
        for entry in (rec.get("network") or []):
            ifaces.add(entry.get("iface", "unknown"))

    network_trends = {}
    for iface in sorted(ifaces):
        rx_values = []
        for _, rec in snapshots:
            entry = next((e for e in (rec.get("network") or []) if e.get("iface") == iface), None)
            rx_values.append(entry.get("rxKBps") if entry else None)
        network_trends[iface] = describe_trend(linear_trend_slope(timestamps, rx_values))

    return {
        "count": len(snapshots),
        "from": timestamps[0].isoformat(),
        "to": timestamps[-1].isoformat(),
        "cpu_trend": cpu_trend,
        "network_trend_rx": network_trends,
    }


# ---------------------------------------------------------------------------
# /bottlenecks  (same as bottleneck_detection.py)
# ---------------------------------------------------------------------------

def find_sustained_episodes(timestamps, values, threshold, min_samples):
    episodes = []
    run_start = None
    for i, v in enumerate(values):
        above = v is not None and v >= threshold
        if above and run_start is None:
            run_start = i
        elif not above and run_start is not None:
            if i - run_start >= min_samples:
                episodes.append(_build_episode(timestamps, values, run_start, i - 1))
            run_start = None
    if run_start is not None and len(values) - run_start >= min_samples:
        episodes.append(_build_episode(timestamps, values, run_start, len(values) - 1))
    return episodes


def _build_episode(timestamps, values, start_idx, end_idx):
    chunk = [v for v in values[start_idx:end_idx + 1] if v is not None]
    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "start": timestamps[start_idx].isoformat(),
        "end": timestamps[end_idx].isoformat(),
        "duration_sec": round((timestamps[end_idx] - timestamps[start_idx]).total_seconds(), 1),
        "peak": round(max(chunk), 1) if chunk else None,
        "samples": end_idx - start_idx + 1,
    }


def classify_episode(cpu_episode, net_values, net_threshold):
    start, end = cpu_episode["start_idx"], cpu_episode["end_idx"]
    net_chunk = [v for v in net_values[start:end + 1] if v is not None]
    net_high_fraction = (
        sum(1 for v in net_chunk if v >= net_threshold) / len(net_chunk) if net_chunk else 0
    )
    return "combined_load" if net_high_fraction >= 0.5 else "cpu_bound"


@app.get("/bottlenecks")
def bottlenecks(
    file: str = Query(..., description="Path to snapshots.jsonl"),
    minutes: Optional[float] = Query(None),
    cpu_sustained_threshold: float = Query(85.0),
    cpu_sustained_min_samples: int = Query(5),
    cpu_spike_threshold: float = Query(95.0),
    net_sustained_threshold_kbps: float = Query(500.0),
    net_sustained_min_samples: int = Query(5),
    skip_first: int = Query(10, description="Skip first N samples (startup transient)"),
):
    snapshots = load_snapshots(Path(file), resolve_since(minutes))
    if len(snapshots) <= skip_first:
        return {"message": f"not enough data after skipping first {skip_first} samples", "count": len(snapshots)}

    snapshots = snapshots[skip_first:]
    timestamps = [ts for ts, _ in snapshots]
    cpu_values = [rec.get("cpuUsedPercent") for _, rec in snapshots]
    net_values = [total_network_kbps(rec) for _, rec in snapshots]

    cpu_episodes = find_sustained_episodes(timestamps, cpu_values, cpu_sustained_threshold, cpu_sustained_min_samples)
    cpu_sustained_indices = {i for ep in cpu_episodes for i in range(ep["start_idx"], ep["end_idx"] + 1)}

    net_episodes = find_sustained_episodes(timestamps, net_values, net_sustained_threshold_kbps, net_sustained_min_samples)

    for ep in cpu_episodes:
        ep["classification"] = classify_episode(ep, net_values, net_sustained_threshold_kbps)
        del ep["start_idx"], ep["end_idx"]

    for ep in net_episodes:
        del ep["start_idx"], ep["end_idx"]

    spikes = [
        {"timestamp": timestamps[i].isoformat(), "value": round(v, 1)}
        for i, v in enumerate(cpu_values)
        if v is not None and v >= cpu_spike_threshold and i not in cpu_sustained_indices
    ]

    return {
        "count": len(snapshots),
        "from": timestamps[0].isoformat(),
        "to": timestamps[-1].isoformat(),
        "sustained_cpu_episodes": cpu_episodes,
        "sustained_network_episodes": net_episodes,
        "isolated_cpu_spikes": spikes,
        "summary": {
            "sustained_cpu_episode_count": len(cpu_episodes),
            "sustained_network_episode_count": len(net_episodes),
            "isolated_cpu_spike_count": len(spikes),
        },
    }

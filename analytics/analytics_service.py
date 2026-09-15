#!/usr/bin/env python3
"""
analytics_service.py

Place this in: ./analytics/analytics_service.py

Reads from local JSON Lines snapshot files instead of MongoDB Atlas.
SnapshotLogger.cs now writes to data/snapshots/{yyyy}/{MM}/{dd}.jsonl on
disk instead of a Mongo collection; this replaces the Mongo-query
load_snapshots() with a local file read. Everything downstream
(stats/trend/bottleneck logic) is unchanged — only where the data comes
from changed. No MongoDB, no MONGO_URI, no external database.

SETUP (run once):
    pip install fastapi uvicorn

Data directory resolution (same precedence as the .NET backend's
AppDataPath.Resolve(), see backend/SystemMonitor.Api/services/AppDataPath.cs):
    1. SYSTEM_INFO_DATA_DIR env var, if set
    2. ./data next to the working directory, if SYSTEM_INFO_ENV=Development
    3. Platform default: %LOCALAPPDATA%\\SystemInfo\\data (Windows) or
       ~/.local/share/SystemInfo/data (Linux)

RUN:
    cd analytics
    uvicorn analytics_service:app --reload --port 8001 --ws none

Then:
    http://localhost:8001/health
    http://localhost:8001/stats
    http://localhost:8001/trend
    http://localhost:8001/bottlenecks
    http://localhost:8001/docs   (interactive API docs)
"""

import json
import os
import platform
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query

app = FastAPI(title="System Monitor Analytics", version="0.3.0")

# ---------------------------------------------------------------------------
# Local data directory resolution — mirrors AppDataPath.Resolve() in the
# .NET backend so both sides agree on where history lives without needing
# to talk to each other about it.
# ---------------------------------------------------------------------------

def resolve_data_dir() -> Path:
    override = os.environ.get("SYSTEM_INFO_DATA_DIR")
    if override:
        return Path(override)

    if os.environ.get("SYSTEM_INFO_ENV", "").lower() == "development":
        return Path.cwd() / "data"

    if platform.system() == "Windows":
        local_app_data = os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))
        return Path(local_app_data) / "SystemInfo" / "data"

    return Path.home() / ".local" / "share" / "SystemInfo" / "data"


DATA_DIR = resolve_data_dir()
SNAPSHOTS_DIR = DATA_DIR / "snapshots"


def parse_timestamp(raw):
    """
    Parse a snapshot timestamp written by SnapshotLogger.cs.

    C#'s DateTime.ToString("o") emits SEVEN fractional-second digits
    ("2026-09-14T10:25:31.1220000Z"), but datetime.fromisoformat only
    accepts 3 or 6 before Python 3.11 — so the obvious one-liner silently
    works on a dev machine and breaks on an older interpreter. Truncate the
    fraction to 6 digits before parsing rather than assume the runtime.

    Returns an aware UTC datetime, or None if the value is unusable.
    """
    if not isinstance(raw, str):
        return None

    text = raw.strip().replace("Z", "+00:00")

    # Trim over-long fractional seconds: ...31.1220000+00:00 -> ...31.122000+00:00
    match = re.match(r"^(.*\.\d{6})\d+(.*)$", text)
    if match:
        text = match.group(1) + match.group(2)

    try:
        ts = datetime.fromisoformat(text)
    except ValueError:
        return None

    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def snapshot_files_for_range(start: datetime, end: datetime):
    """
    Yields only the daily .jsonl files that can possibly contain data in
    [start, end] — never reads the whole history for a request scoped to
    the last N minutes/hours.
    """
    if not SNAPSHOTS_DIR.exists():
        return

    day = start.date()
    last_day = end.date()
    while day <= last_day:
        f = SNAPSHOTS_DIR / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}.jsonl"
        if f.exists():
            yield f
        day += timedelta(days=1)


# ---------------------------------------------------------------------------
# Shared loading logic — reads only the relevant local JSONL files
# ---------------------------------------------------------------------------

def load_snapshots(since: Optional[datetime]):
    """
    Returns a list of (timestamp, record) tuples, sorted oldest-first,
    same shape the rest of this file already expects — so stats/trend/
    bottleneck logic below needed no changes.

    A malformed/partial JSON line (e.g. from an unclean shutdown mid-write)
    is logged and skipped rather than raised — one bad line must not take
    down analytics for an entire day's history.
    """
    now = datetime.now(timezone.utc)
    start = since if since is not None else datetime(1970, 1, 1, tzinfo=timezone.utc)

    snapshots = []
    for path in snapshot_files_for_range(start, now):
        with open(path, "r", encoding="utf-8") as fh:
            for line_no, line in enumerate(fh, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    doc = json.loads(line)
                except json.JSONDecodeError as e:
                    print(f"[analytics] skipping malformed line {path}:{line_no}: {e}")
                    continue

                ts = parse_timestamp(doc.get("timestamp"))
                if ts is None:
                    print(f"[analytics] skipping line with bad timestamp {path}:{line_no}")
                    continue

                if since is not None and ts < since:
                    continue

                snapshots.append((ts, doc))

    snapshots.sort(key=lambda pair: pair[0])
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
    if not SNAPSHOTS_DIR.exists():
        return {
            "status": "ok",
            "storage": "local",
            "detail": "data directory not created yet — no snapshots recorded so far",
            "data_dir": str(DATA_DIR),
        }
    return {"status": "ok", "storage": "local", "data_dir": str(DATA_DIR)}


# ---------------------------------------------------------------------------
# /stats
# ---------------------------------------------------------------------------

@app.get("/stats")
def stats(minutes: Optional[float] = Query(None, description="Only analyze the last N minutes")):
    snapshots = load_snapshots(resolve_since(minutes))
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
# /trend
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
    minutes: Optional[float] = Query(None, description="Only analyze the last N minutes"),
    window: int = Query(20, description="Rolling mean window size in samples"),
):
    snapshots = load_snapshots(resolve_since(minutes))
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
# /bottlenecks
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
    minutes: Optional[float] = Query(None),
    cpu_sustained_threshold: float = Query(85.0),
    cpu_sustained_min_samples: int = Query(5),
    cpu_spike_threshold: float = Query(95.0),
    net_sustained_threshold_kbps: float = Query(500.0),
    net_sustained_min_samples: int = Query(5),
    skip_first: int = Query(10, description="Skip first N samples (startup transient)"),
):
    snapshots = load_snapshots(resolve_since(minutes))
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
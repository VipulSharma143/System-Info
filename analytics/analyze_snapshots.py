#!/usr/bin/env python3
"""
analyze_snapshots.py

Place this in: ./analytics/analyze_snapshots.py  (project root)

First milestone for Phase 7 (Python Analytics). Reads the JSONL log
produced by SnapshotLogger.cs and prints basic stats (mean/min/max) over
a requested time window. No HTTP service yet — just proving the pipeline
(C# background loop -> file -> Python) produces correct numbers before
building anything on top of it.

Usage (from project root):
    python3 analytics/analyze_snapshots.py --file backend/SystemMonitor.Api/data/snapshots.jsonl
    python3 analytics/analyze_snapshots.py --file backend/SystemMonitor.Api/data/snapshots.jsonl --minutes 15

Expects each line shaped exactly like SnapshotLogger.cs writes:
    {
      "timestamp": "2026-09-08T10:15:00Z",
      "cpuUsedPercent": 23.4,
      "network": [ { "iface": "eth0", "rxKBps": 12.3, "txKBps": 4.5 }, ... ]
    }
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="Analyze system snapshot log.")
    p.add_argument("--file", required=True, help="Path to snapshots.jsonl")
    p.add_argument("--minutes", type=float, default=None,
                    help="Only analyze the last N minutes (default: all data)")
    return p.parse_args()


def load_snapshots(path: Path, since):
    snapshots = []
    skipped = 0
    with path.open("r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            ts_raw = record.get("timestamp")
            try:
                ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except Exception:
                skipped += 1
                continue

            if since is not None and ts < since:
                continue

            snapshots.append((ts, record))

    if skipped:
        print(f"[warn] skipped {skipped} malformed lines", file=sys.stderr)

    return snapshots


def summarize(values, label):
    values = [v for v in values if v is not None]
    if not values:
        print(f"  {label}: no data")
        return
    print(f"  {label}: mean={sum(values)/len(values):.2f}  "
          f"min={min(values):.2f}  max={max(values):.2f}  n={len(values)}")


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

    window_desc = f"last {args.minutes} min" if args.minutes else "all time"
    print(f"Analyzed {len(snapshots)} snapshots ({window_desc}), "
          f"from {snapshots[0][0]} to {snapshots[-1][0]}\n")

    cpu_vals = [rec.get("cpuUsedPercent") for _, rec in snapshots]

    # network is a list per snapshot (one entry per interface); flatten and
    # aggregate per-interface totals across all snapshots in the window.
    rx_by_iface: dict[str, list[float]] = {}
    tx_by_iface: dict[str, list[float]] = {}
    for _, rec in snapshots:
        for entry in (rec.get("network") or []):
            iface = entry.get("iface", "unknown")
            rx_by_iface.setdefault(iface, []).append(entry.get("rxKBps"))
            tx_by_iface.setdefault(iface, []).append(entry.get("txKBps"))

    print("Stats:")
    summarize(cpu_vals, "CPU %")

    if not rx_by_iface:
        print("  Network: no data")
    else:
        for iface in rx_by_iface:
            summarize(rx_by_iface[iface], f"Network RX ({iface}) KB/s")
            summarize(tx_by_iface[iface], f"Network TX ({iface}) KB/s")


if __name__ == "__main__":
    main()

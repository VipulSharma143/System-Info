# Project Status

**Project:** System Performance & Monitoring Platform (System-Info)
**Last updated:** 2026-09-08
**Current phase:** Phase 8 (Database) complete · Phase 9 (Dashboard UI) not started
**Repo:** [github.com/VipulSharma143/System-Info](https://github.com/VipulSharma143/System-Info)

---

## Roadmap

| Phase | Status | Summary |
|---|---|---|
| 1 — Environment Setup | ✅ Done | Toolchains verified (.NET 10, Node, gcc, cmake, nasm) |
| 2 — Basic Application | ✅ Done | React ↔ .NET pipeline proven |
| 3 — System Monitoring | ✅ Done | Live CPU/RAM/disk/network/process reads from `/proc` |
| 4 — Native C++ Engine | ✅ Done | P/Invoke bridge, hardware reads |
| 5 — Hardware Monitoring | ✅ Done | GPU vendor detection, thermal, fan — graceful degradation |
| 6 — Assembly | ✅ Done | NASM scalar + SIMD CPU benchmark |
| Cross-Platform Refactor | ✅ Done | `ISystemInfoProvider` for Linux & Windows (Windows untested) |
| Optimization Pass | ✅ Done | Background caching, consolidated endpoint, parallel reads |
| 7 — Python Analytics | ✅ Done | Snapshot logging, trend detection, bottleneck classification |
| 8 — Database | ✅ Done | MongoDB Atlas (swapped in for the originally-planned PostgreSQL) |
| 9 — Dashboard UI | ⬜ Not started | Surface analytics data visually in the frontend |
| 10 — Maintenance & Extensibility | ⬜ Not started | Hardening pass — see below |

---

## Phase Details

### Phase 1 — Environment Setup
Linux Mint 22.3, .NET SDK 10.0.111, Node v24.20/npm 11.19, git 2.43, gcc/g++ 13.3, gdb 15.1, cmake 3.28.3, nasm 2.16.01.

### Phase 2 — Basic Application
Vite + React + TS frontend, `dotnet webapi` backend, CORS configured, proven with a live weather-forecast fetch (removed once real data landed in Phase 3).

### Phase 3 — System Monitoring
Live CPU%, RAM%, disk usage, network throughput, and a top-50 process list, reading directly from `/proc` and `DriveInfo`.
**Bug found & fixed:** an `Infinity`/JSON serialization crash on certain disk mounts — resolved with a `TotalSize > 0` filter and a `DriveFormat` exclusion list.

### Phase 4 — Native C++ Engine
CMake-built shared library, P/Invoke bridge to C#. Verified with a real hardware read (CPU model/core count) and a direct C# vs C++ CPU-usage comparison (87.2% vs 69.2% — attributed to sampling-timing differences, not a bug).

### Phase 5 — Hardware Monitoring
*(NVIDIA stub · AMD written but unverified on real hardware)*
CPU temperature via sysfs thermal zone (72°C confirmed). GPU vendor detection via a dynamic `/sys/class/drm` scan. Vendor-conditional dispatch — AMD gets a real usage% read, Intel/unknown honestly report "unavailable." Fan RPM correctly reports unavailable on this laptop (no exposed sensor). Full SMART storage health deferred (needs root).

### Phase 6 — Assembly
NASM toolchain proven via CMake's `ASM_NASM` support. A real CPU benchmark (~240–300M ops/sec on this Celeron 1017U) built and timed via `std::chrono`. SIMD (SSE2) vs scalar comparison: **3.94–3.95× speedup**, close to the theoretical 4× max.

### Cross-Platform Refactor
C#: `ISystemInfoProvider` interface with independent Linux/Windows implementations, selected via `OperatingSystem.IsWindows()/IsLinux()`. C++: shared header + `common.cpp` + `linux_provider.cpp` + `windows_provider.cpp`, `CMakeLists.txt` picks the right one via `if(WIN32)`. Windows compiles cleanly but is **untested** (no Windows hardware).

### Optimization Pass
- `native/build.sh` — chains `cmake && make && cp` into one command.
- Background sampling + caching — CPU endpoint 21ms (was ~200ms), network endpoint 28ms (was ~500ms).
- Consolidated `/api/system/all` — 5 polled requests → 1.
- Parallelized process reads (`Task.Run` + `Task.WhenAll`) — 947ms → 661ms.

### Phase 7 — Python Analytics
Five staged, individually-verified steps:
1. **Background logging (C#)** — `SnapshotLogger.cs` samples CPU/network. A 3-second startup warm-up delay was added after confirming the first several samples genuinely reflected real load from .NET's own JIT/Kestrel startup — not a measurement bug.
2. **Basic stats (Python)** — `analyze_snapshots.py`: mean/min/max, verified against live dashboard values.
3. **Trend detection** — `trend_analysis.py`: rolling mean + least-squares linear trend, pure Python.
4. **Bottleneck detection** — `bottleneck_detection.py`: sustained-load episodes (not single spikes), classified `cpu_bound` vs `combined_load`.
5. **HTTP service + .NET integration** — `analytics_service.py` (FastAPI) wraps all three; `AnalyticsEndpoints.cs` proxies `/api/analytics/*` with graceful 503 degradation if Python's down.

### Phase 8 — Database *(MongoDB Atlas, not PostgreSQL)*
Switched from the originally-planned PostgreSQL mid-phase — an Atlas cluster was already available from an earlier project, and the JSONL shape maps onto Mongo documents with no relational schema needed. Trade-off accepted: gave up the SQL/relational learning value for lower setup friction.

Verified in stages:
1. Atlas connectivity confirmed from Python before any app code changed.
2. Manual insert + read-back proved the document shape.
3. `SnapshotLogger.cs` rewritten to `InsertOne` into Mongo — same public interface, same graceful degradation.
4. `analytics_service.py` rewritten to query Mongo. **Bug found & fixed:** a leftover manual test document had `timestamp` as a string while real documents store a native Mongo datetime — mixed types crashed the loader. Fixed with defensive type handling + deleting the stray document.
5. Re-verified all three endpoints against 727+ real documents.

**Resolves both Phase 7 deferred items:** no more unbounded flat file, no more full-file re-parse per request.

### Phase 9 — Advanced Dashboard UI *(planned)*
Surface Phase 7/8 analytics data visually instead of curl/JSON only:
- Dedicated analytics panel in the React dashboard
- Live trend charts (CPU/network, from `/api/analytics/trend`)
- Bottleneck episode timeline, visually distinguishing `cpu_bound` vs `combined_load`
- Graceful "analytics unavailable" UI state on a 503, not a broken panel
- Every field the API already returns should be reachable in the UI, not a partial summary

### Phase 10 — Maintenance & Extensibility *(planned)*
Hardening, not new features:
- **MongoDB retention policy** — no TTL/expiry yet; collection will grow unbounded over time
- **Windows verification** — compiles, never executed (blocked on hardware)
- **AMD GPU verification** — blocked on hardware
- **Full SMART storage health** — needs root, deferred
- **Automated tests** — everything so far verified manually; worth a real test suite once the feature set stabilizes
- **Deployment hardening** — CORS hardcoded to `localhost:5173`, secrets via ad-hoc env vars rather than a secrets manager, no CI/CD

---

## Known / Outstanding Items

- 🔴 **Security:** an Atlas password was pasted in plaintext during Phase 8 debugging. **Needs rotating** (Atlas → Database Access → edit user → reset password) and `~/.bashrc` updated to match. **Not yet done.**
- MongoDB collection has no TTL/rotation (Phase 10).
- `SnapshotLogger.cs` only logs CPU + network (not RAM/disk/process) — a deliberate scope decision to keep the hot-path loop fast.
- Windows testing — blocked on hardware access.
- AMD GPU verification — blocked on hardware access.
- Full SMART storage health — deferred, needs root.
- CPU temp / fan RPM on Windows — likely permanently "unavailable" without undocumented vendor APIs.

---

## Immediate Next Action

1. **Rotate the exposed Atlas password.**
2. Commit Phase 8's work.
3. Begin Phase 9 — start with the trend chart (`/api/analytics/trend` already returns clean, chart-ready data); verify one panel end-to-end before adding the bottleneck timeline.

---

## What Should Not Change

- The staged, "prove it before adding the next layer" discipline — held through every phase, including the Phase 8 mixed-timestamp bug, found by re-verifying against real data rather than guessing.
- The graceful-degradation pattern — hardware reads, the analytics proxy, and Mongo connection failures all report "unavailable"/"degraded" honestly instead of crashing or faking data.
- `native/build.sh` as the only way to rebuild the native library.
- Git commit timing remains the user's call.

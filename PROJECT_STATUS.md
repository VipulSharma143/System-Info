<div align="center">

# 📋 Project Status & Build Log

### System Performance & Monitoring Platform — Full Engineering History

![Phases Complete](https://img.shields.io/badge/Phases_Complete-8%2F10-success?style=for-the-badge)
![Status](https://img.shields.io/badge/Current_Phase-Dashboard_UI-blue?style=for-the-badge)
![Last Updated](https://img.shields.io/badge/Updated-2026--09--08-lightgrey?style=for-the-badge)

[Roadmap](#-roadmap) • [Phase Log](#-phase-log) • [Known Issues](#-known--outstanding-items) • [Next Steps](#-immediate-next-action)

---

</div>

## 🗺️ Roadmap

```
✅ ─ ✅ ─ ✅ ─ ✅ ─ ✅ ─ ✅ ─ ✅ ─ ✅ ─ ⬜ ─ ⬜
 1    2    3    4    5    6    7    8    9   10
```

| # | Phase | Status | Summary |
|:-:|---|:-:|---|
| 1 | Environment Setup | ✅ | Toolchains verified (.NET 10, Node, gcc, cmake, nasm) |
| 2 | Basic Application | ✅ | React ↔ .NET pipeline proven |
| 3 | System Monitoring | ✅ | Live CPU/RAM/disk/network/process reads from `/proc` |
| 4 | Native C++ Engine | ✅ | P/Invoke bridge, hardware reads |
| 5 | Hardware Monitoring | ✅ | GPU vendor detection, thermal, fan — graceful degradation |
| 6 | Assembly | ✅ | NASM scalar + SIMD CPU benchmark |
| — | Cross-Platform Refactor | ✅ | `ISystemInfoProvider` for Linux & Windows |
| — | Optimization Pass | ✅ | Background caching, consolidated endpoint, parallel reads |
| 7 | Python Analytics | ✅ | Snapshot logging, trend detection, bottleneck classification |
| 8 | Database | ✅ | MongoDB Atlas *(swapped in for the originally-planned PostgreSQL)* |
| 9 | Dashboard UI | ⬜ | Surface analytics data visually in the frontend |
| 10 | Maintenance & Extensibility | ⬜ | Hardening pass |

<br>

## 🔍 Phase Log

<details open>
<summary><b>✅ Phase 1 — Environment Setup</b></summary>
<br>

Linux Mint 22.3 · .NET SDK 10.0.111 · Node v24.20/npm 11.19 · git 2.43 · gcc/g++ 13.3 · gdb 15.1 · cmake 3.28.3 · nasm 2.16.01

</details>

<details>
<summary><b>✅ Phase 2 — Basic Application</b></summary>
<br>

Vite + React + TS frontend, `dotnet webapi` backend, CORS configured. Proven with a live weather-forecast fetch (removed once real data landed in Phase 3).

</details>

<details>
<summary><b>✅ Phase 3 — System Monitoring</b></summary>
<br>

Live CPU%, RAM%, disk usage, network throughput, and a top-50 process list, reading directly from `/proc` and `DriveInfo`.

> 🐛 **Bug found & fixed:** an `Infinity`/JSON serialization crash on certain disk mounts — resolved with a `TotalSize > 0` filter and a `DriveFormat` exclusion list.

</details>

<details>
<summary><b>✅ Phase 4 — Native C++ Engine</b></summary>
<br>

CMake-built shared library, P/Invoke bridge to C#. Verified with a real hardware read (CPU model/core count) and a direct C# vs C++ CPU-usage comparison (87.2% vs 69.2% — attributed to sampling-timing differences, not a bug).

</details>

<details>
<summary><b>✅ Phase 5 — Hardware Monitoring</b></summary>
<br>

*NVIDIA stub · AMD written but unverified on real hardware*

- CPU temperature via sysfs thermal zone — **72°C confirmed**
- GPU vendor detection via dynamic `/sys/class/drm` scan
- Vendor-conditional dispatch — AMD gets a real usage% read; Intel/unknown honestly report `"unavailable"`
- Fan RPM correctly reports unavailable on this laptop (no exposed sensor)
- Full SMART storage health deferred (needs root)

</details>

<details>
<summary><b>✅ Phase 6 — Assembly</b></summary>
<br>

NASM toolchain proven via CMake's `ASM_NASM` support. A real CPU benchmark (~240–300M ops/sec on this Celeron 1017U) built and timed via `std::chrono`.

> ⚡ **SIMD (SSE2) vs scalar:** 3.94–3.95× speedup — close to the theoretical 4× max.

</details>

<details>
<summary><b>✅ Cross-Platform Refactor</b></summary>
<br>

**C#:** `ISystemInfoProvider` interface with independent Linux/Windows implementations, selected via `OperatingSystem.IsWindows()/IsLinux()`.
**C++:** shared header + `common.cpp` + `linux_provider.cpp` + `windows_provider.cpp`, `CMakeLists.txt` picks the right one via `if(WIN32)`. Windows compiles cleanly; verification pending real Windows hardware.

</details>

<details>
<summary><b>✅ Optimization Pass</b></summary>
<br>

| Change | Before | After |
|---|:-:|:-:|
| `native/build.sh` (chained cmake+make+cp) | manual, error-prone | one command |
| CPU endpoint (background cache) | ~200ms | **21ms** |
| Network endpoint (background cache) | ~500ms | **28ms** |
| `/api/system/all` | 5 requests | **1 request** |
| Process list (`Task.WhenAll`) | 947ms | **661ms** |

</details>

<details>
<summary><b>✅ Phase 7 — Python Analytics</b></summary>
<br>

Five staged, individually-verified steps:

1. **Background logging (C#)** — `SnapshotLogger.cs` samples CPU/network. A 3s startup warm-up delay was added after confirming the first several samples genuinely reflected real load from .NET's own JIT/Kestrel startup — not a measurement bug.
2. **Basic stats (Python)** — `analyze_snapshots.py`: mean/min/max, verified against live dashboard values.
3. **Trend detection** — `trend_analysis.py`: rolling mean + least-squares linear trend, pure Python.
4. **Bottleneck detection** — `bottleneck_detection.py`: sustained-load episodes (not single spikes), classified `cpu_bound` vs `combined_load`.
5. **HTTP service + .NET integration** — `analytics_service.py` (FastAPI) wraps all three; `AnalyticsEndpoints.cs` proxies `/api/analytics/*` with graceful 503 degradation if Python's down.

</details>

<details>
<summary><b>✅ Phase 8 — Database <i>(MongoDB Atlas, not PostgreSQL)</i></b></summary>
<br>

> 🔄 **Decision:** switched from the originally-planned PostgreSQL mid-phase — an Atlas cluster was already available from an earlier project, and the JSONL shape maps onto Mongo documents with no relational schema needed. Trade-off accepted: gave up the SQL/relational learning value for lower setup friction.

Verified in stages:

1. Atlas connectivity confirmed from Python before any app code changed
2. Manual insert + read-back proved the document shape
3. `SnapshotLogger.cs` rewritten to `InsertOne` into Mongo — same public interface, same graceful degradation
4. `analytics_service.py` rewritten to query Mongo
5. Re-verified all three endpoints against **727+ real documents**

> 🐛 **Bug found & fixed:** a leftover manual test document had `timestamp` as a string while real documents store a native Mongo datetime — mixed types crashed the loader. Fixed with defensive type handling + deleting the stray document.

✅ **Resolves both Phase 7 deferred items:** no more unbounded flat file, no more full-file re-parse per request.

</details>

<details>
<summary><b>⬜ Phase 9 — Advanced Dashboard UI <i>(planned)</i></b></summary>
<br>

Surface Phase 7/8 analytics data visually instead of curl/JSON only:

- [ ] Dedicated analytics panel in the React dashboard
- [ ] Live trend charts (CPU/network, from `/api/analytics/trend`)
- [ ] Bottleneck episode timeline — visually distinguishing `cpu_bound` vs `combined_load`
- [ ] Graceful "analytics unavailable" UI state on a 503, not a broken panel
- [ ] Every field the API already returns should be reachable in the UI, not a partial summary

</details>

<details>
<summary><b>⬜ Phase 10 — Maintenance & Extensibility <i>(planned)</i></b></summary>
<br>

Hardening, not new features:

- [ ] **MongoDB retention policy** — no TTL/expiry yet; collection will grow unbounded over time
- [ ] **Windows verification** — compiles, never executed (blocked on hardware)
- [ ] **AMD GPU verification** — blocked on hardware
- [ ] **Full SMART storage health** — needs root, deferred
- [ ] **Automated tests** — everything so far verified manually; worth a real suite once features stabilize
- [ ] **Deployment hardening** — CORS hardcoded to `localhost:5173`, secrets via ad-hoc env vars, no CI/CD

</details>

<br>

## ⚠️ Known / Outstanding Items

| Priority | Item | Status |
|:-:|---|---|
| 🔴 | Atlas password was pasted in plaintext during Phase 8 debugging — needs rotating | **Not done** |
| 🟡 | MongoDB has no TTL/rotation | Deferred to Phase 10 |
| 🟢 | `SnapshotLogger.cs` only logs CPU + network, not RAM/disk/process | Deliberate scope decision |
| ⚪ | Windows testing | Blocked — no hardware |
| ⚪ | AMD GPU verification | Blocked — no hardware |
| ⚪ | Full SMART storage health | Deferred — needs root |
| ⚪ | CPU temp / fan RPM on Windows | Likely permanent limitation |

<br>

## 🧭 What Should Not Change

- The staged, **"prove it before adding the next layer"** discipline — held through every phase, including the Phase 8 mixed-timestamp bug, found by re-verifying against real data rather than guessing
- The **graceful-degradation pattern** — hardware reads, the analytics proxy, and Mongo connection failures all report `"unavailable"`/`"degraded"` honestly instead of crashing or faking data
- `native/build.sh` as the only way to rebuild the native library
- Git commit timing remains the user's call

<br>

---

<div align="center">

See [`README.md`](./README.md) for the project overview and setup instructions.

</div>

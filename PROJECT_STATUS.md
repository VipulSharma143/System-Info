# 📋 Project Status & Build Log

This document tracks the phase-by-phase development progress, architectural decisions, and verification steps for the **System Info** performance monitoring engine.

---

## 🚦 Phase Overview

| Phase | Milestone | Layer / Tech | Status |
|:---:|:---|:---|:---:|
| **01** | Toolchain & Scaffold Setup | .NET 10, React, CMake, NASM | ✅ Completed |
| **02** | Full-Stack Interop Pipeline | React ↔ C# REST API | ✅ Completed |
| **03** | Linux Kernel Metrics Engine | `/proc` & `/sys` Parser | ✅ Completed |
| **04** | Native Hardware Interop | C++20 / P-Invoke FFI | ✅ Completed |
| **05** | Vendor-Aware GPU & Fan Parsing | `/sys/class/drm` & `/sys/class/hwmon` | ✅ Completed |
| **06** | x86-64 Assembly Benchmark | NASM (Scalar vs SSE2 SIMD) | ✅ Completed |
| **07** | Cross-Platform Abstraction | `ISystemInfoProvider` (Linux & Windows) | ✅ Completed |
| **08** | Analytics & Anomaly Detection | Python Engine | 🟡 In Progress |
| **09** | Telemetry Persistence | PostgreSQL Storage | ⚪ Planned |

---

## 🔍 Detailed Phase Log

### ✅ Phase 1: Toolchain & Scaffolding
- Set up the multi-language repository structure.
- Configured build pipelines for .NET 10 SDK, Node 20+, CMake 3.20+, and NASM.
- Verified native compilation toolchain (GCC/G++ on Linux, MSVC compatibility on Windows).

### ✅ Phase 2: React ↔ .NET 10 Pipeline
- Built the initial REST controller endpoints in ASP.NET Core.
- Created the React + TypeScript frontend dashboard powered by Vite.
- Implemented real-time polling logic with a 2-second heartbeat interval.

### ✅ Phase 3: Raw Linux Kernel Metric Parser
- **No wrapper libraries:** Avoided standard metrics wrappers to build direct file descriptor readers.
- Parsed `/proc/stat` for accurate, non-blocking multi-core CPU usage calculations.
- Parsed `/proc/meminfo` for active, free, available, and buffered RAM breakdowns.
- Scanned `/proc/[pid]/` for real-time process list extraction and per-process memory stats.
- Monitored network throughput via `/proc/net/dev` and disk operations via `/proc/diskstats`.

### ✅ Phase 4: Native C++ Engine (P/Invoke Bridge)
- Built a shared native library (`libsystemmonitor_native.so`) using CMake.
- Established clean C# ↔ C++ data boundaries using managed P/Invoke bindings.
- Extracted raw CPU model strings, package thermals, and core temperature zones.

### ✅ Phase 5: Dynamic GPU & Fan Sensor Discovery
- Implemented automated path discovery traversing `/sys/class/drm` and `/sys/class/hwmon`.
- Built vendor dispatch logic for **NVIDIA**, **AMD**, and **Intel** graphics cards.
- **Graceful Hardware Degradation:** Engineered fallback handlers so virtual machines, headless servers, and unsupported sensors return clean `"unavailable"` indicators rather than crashing.

### ✅ Phase 6: Hand-Crafted x86-64 Assembly Engine
- Hand-wrote a compute-intensive CPU benchmark in raw NASM assembly.
- Built two distinct execution paths for direct performance comparison:
  1. **Scalar Routine:** Standard general-purpose registers (`RAX`, `RCX`, `RDX`).
  2. **SIMD Routine:** Vectorized SSE2 instruction set registers (`XMM0`-`XMM7`).
- Bound the benchmark routines into the C++ native layer and exposed execution time metrics to the dashboard.

### ✅ Phase 7: Cross-Platform Provider Abstraction
- Designed the `ISystemInfoProvider` interface to decouple metric consumption from OS specifics.
- Implemented `LinuxSystemInfoProvider` using direct kernel filesystem readers.
- Implemented `WindowsSystemInfoProvider` using WMI queries and `PerformanceCounter` classes.
- Added runtime OS detection in `Program.cs` to auto-select the correct provider at startup.

---

## 🔮 Upcoming Phases

### 🟡 Phase 8: Python Analytics Layer (In Progress)
- [ ] Lightweight daemon/script for statistical trend calculation.
- [ ] Automated bottleneck detection (CPU thermal throttling vs high I/O wait states).
- [ ] Anomaly detection for runaway memory leaks and zombie processes.

### ⚪ Phase 9: Persistent Storage & Historical Trends
- [ ] PostgreSQL schema for logging historical system snapshots.
- [ ] Benchmark comparison database (compare SIMD vs Scalar runs over time).
- [ ] Frontend interactive charts for long-term telemetry trends.

---

## 🧪 Verification & Testing Checklist

- [x] Backend runs cleanly on Linux via `dotnet run`.
- [x] Native library compiles with zero warnings under GCC (`-Wall -Wextra`).
- [x] NASM routines assemble to valid ELF64 / Win64 object formats.
- [x] Frontend builds cleanly without TypeScript compiler errors (`tsc --noEmit`).
- [x] Metric polling gracefully recovers if the backend is temporarily restarted.

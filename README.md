<div align="center">

# 🖥️ System Info

### Multi-Language System Performance Monitor

**A from-scratch system profiler built by reading raw kernel interfaces directly —
no wrapper libraries, no shell commands, just pure low-level engineering.**

[![.NET](https://img.shields.io/badge/.NET-10.0-512BD4?style=for-the-badge&logo=dotnet&logoColor=white)](https://dotnet.microsoft.com/)
[![React](https://img.shields.io/badge/React-18+-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![C++](https://img.shields.io/badge/C++-20-00599C?style=for-the-badge&logo=c%2B%2B&logoColor=white)](https://isocpp.org/)
[![Assembly](https://img.shields.io/badge/Assembly-x86--64-FF6600?style=for-the-badge&logo=assemblyscript&logoColor=white)](https://www.nasm.us/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

[Getting Started](#-getting-started) • [Architecture](#-architecture) • [Features](#-features) • [Project Status](#-project-status)

---

</div>

## 🎯 What is this?

A full-stack system monitor where **every layer does real, non-trivial work** — CPU, memory, disk, network, and process data read directly from Linux `/proc` and `/sys`, a native C++ engine for hardware sensors, and hand-optimized x86-64 Assembly for CPU benchmarking with scalar-vs-SIMD comparison.

```
React (TypeScript) ──► .NET 10 (C#) ──► C++ (CMake) ──► x86-64 Assembly (NASM)
```

> **This is not a wrapper.** Most system monitors shell out to existing CLI tools or import high-level metrics libraries. This project deliberately avoids that: every single data point is sourced directly from kernel interfaces and first-principles native code.

<br>

## 💡 Why build this?

| Typical Monitor | System Info |
|---|---|
| Wraps `psutil` or shells out to `top` | Reads `/proc/stat`, `/proc/meminfo`, `/sys/class/hwmon` directly |
| Monolithic / single-language | Five-language pipeline with real managed-to-native FFI |
| CPU metrics from an opaque API call | Hand-written Assembly benchmark with SIMD optimization proof |
| Single-platform or platform-coupled | Clean `ISystemInfoProvider` decoupling Linux & Windows |
| Crashes on missing hardware | Graceful degradation with honest status reporting |

<br>

## ✨ Features

### 📊 Live System Dashboard
Real-time CPU load %, RAM consumption breakdown, disk read/write throughput, network I/O, and an active process explorer — polled and refreshed every 2 seconds.

### 🐧 Cross-Platform Backend Abstraction
A clean, modular `ISystemInfoProvider` interface with independent implementations:
- **Linux:** Direct parsing of `/proc` and `/sys` filesystems.
- **Windows:** Native integrations via WMI and `PerformanceCounter`.

### ⚙️ Native C++ Engine
Hardware-level reads — CPU model string extraction, thermal zone monitoring, and GPU vendor resolution — exposed cleanly to managed C# code via high-performance P/Invoke.

### 🎮 Vendor-Aware GPU Detection
Dynamically traverses `/sys/class/drm`, resolving and dispatching vendor-specific logic (NVIDIA, AMD, Intel) while failing gracefully on unsupported devices.

### 🧮 Hand-Crafted x86-64 Assembly
A real CPU benchmark compute loop written directly in NASM Assembly, featuring a companion SIMD (SSE2) implementation to measure real scalar-vs-vector execution deltas.

### 📈 Python Analytics Service
A background service continuously logs CPU and network samples to a JSON Lines file. A FastAPI service reads that log to compute rolling stats, linear trend detection (climbing/dropping/flat), and bottleneck detection — sustained high-load episodes and isolated spikes, classified as CPU-bound or combined CPU+network load. The .NET backend proxies to this service over HTTP, degrading gracefully if it's not running.

### 🛡️ Graceful Degradation Throughout
Missing thermal sensors, unreadable fans, headless GPUs, or an unreachable analytics service all report `"unavailable"` with integrity rather than returning faked dummy metrics or crashing the runtime.

<br>

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Frontend                         │
│                React + TypeScript (Vite)                │
│           Live dashboard · Polling · Rendering          │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP / JSON REST
┌────────────────────────────▼────────────────────────────┐
│                        Backend                          │
│                     C# / .NET 10                        │
│          REST API · Cross-platform orchestration        │
│    ┌───────────────────────────────────────────────┐    │
│    │          ISystemInfoProvider Interface        │    │
│    │   Linux (/proc, /sys)   │   Windows (WMI)     │    │
│    └───────────────────────────────────────────────┘    │
└─────────────┬───────────────────────────────┬───────────┘
              │ P/Invoke (Native FFI)          │ HTTP (proxy)
┌─────────────▼───────────────────────┐  ┌─────▼─────────────┐
│           Native Engine              │  │  Analytics Service │
│              C++ (CMake)             │  │  Python (FastAPI)  │
│  Hardware reads · Thermals · GPU     │  │  Stats · Trend ·   │
│                                       │  │  Bottleneck detect │
└─────────────┬─────────────────────────┘  └────────────────────┘
              │ Direct Object Linkage
┌─────────────▼───────────────────────────────────────────┐
│                   Performance Layer                     │
│                 x86-64 Assembly (NASM)                  │
│        Scalar Compute  │  Vectorized SIMD (SSE2)        │
└─────────────────────────────────────────────────────────┘
```

<br>

## 🧰 Tech Stack

| Layer | Technology | Responsibility |
|:---|:---|:---|
| **Frontend** | React 18, TypeScript, Vite | Responsive UI, state polling, metrics visualization |
| **Backend** | C#, .NET 10 Web API | REST endpoints, system orchestration, platform dispatch |
| **Native Engine** | C++20, CMake | Kernel file descriptor reads, hardware identification |
| **Performance** | x86-64 Assembly (NASM) | Scalar & SIMD instruction benchmarking |
| **Analytics** | Python, FastAPI | Bottleneck detection, trend analysis, HTTP analytics service |
| **Storage** *(Planned)* | PostgreSQL | Historical metric logging, benchmark persistence |

<br>

## 🚀 Getting Started

### Prerequisites

- **.NET SDK:** 10.0+
- **Node.js:** 20.x or higher
- **Python:** 3.10+ (for the analytics service)
- **Build Tools:** CMake 3.20+, NASM 2.15+
- **Compiler:** GCC/G++ 12+ (Linux) or MSVC / Visual Studio 2022+ (Windows)

---

### 1. Build the Native Engine & Assembly Layer

```bash
cd native
mkdir -p build && cd build
cmake ..
make
# Copy the compiled shared library to the API bin directory
cp libsystemmonitor_native.so ../../backend/SystemMonitor.Api/
```

### 2. Start the .NET Backend API

```bash
cd backend/SystemMonitor.Api
dotnet run
```
*API will spin up on `http://localhost:XXXX` (or `https://localhost:XXXX`).*

### 3. Launch the Frontend

```bash
cd frontend
npm install
npm run dev
```
*Dashboard will be available at `http://localhost:XXXX`.*

### 4. (Optional) Start the Analytics Service

```bash
pip install fastapi uvicorn
cd analytics
uvicorn analytics_service:app --reload --port 8001
```
*Enables `/api/analytics/stats`, `/api/analytics/trend`, and `/api/analytics/bottlenecks` on the backend. The dashboard and core system endpoints work fine without this running — analytics endpoints degrade gracefully to a 503 if it's not up.*

<br>

## 📍 Project Status

> Development follows a verified, phase-by-phase roadmap. Every tier is tested and benchmarked before the next layer is integrated. See [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) for the deep-dive dev log.

- [x] **Phase 1: Environment & Foundations** — Cross-compilation toolchains & workspace scaffolding.
- [x] **Phase 2: Full-Stack Pipeline** — React dashboard connected to .NET 10 controller layer.
- [x] **Phase 3: Kernel System Monitoring** — Parsing raw `/proc/stat`, `/proc/meminfo`, `/proc/[pid]/`.
- [x] **Phase 4: Native C++ Integration** — P/Invoke interop, CPU temp, thermal throttling checks.
- [x] **Phase 5: Vendor GPU & Fan Detection** — Scanning `/sys/class/drm` and dynamic fallback routing.
- [x] **Phase 6: x86-64 Assembly Engine** — Hand-crafted NASM scalar + SSE2 SIMD benchmark workloads.
- [x] **Cross-Platform Refactor** — Unified `ISystemInfoProvider` for Linux & Windows, plus a matching native C++ provider split; Windows paths compile but are untested (no Windows hardware available).
- [x] **Phase 7: Python Analytics Engine** — Background CPU/network snapshot logging, statistical trend analysis, and sustained-load bottleneck detection with CPU-bound vs combined-load classification, exposed via a FastAPI service the .NET backend calls over HTTP.
- [ ] **Phase 8: Persistence Layer** — PostgreSQL telemetry ingestion for long-term historical charts, replacing the current flat-file (JSONL) snapshot log.
- [ ] **Phase 9: Advanced Dashboard** — Not yet started.

<br>

## 📂 Project Structure

```
system-info/
├── frontend/                     # React + TypeScript Web App
│   ├── src/
│   │   ├── components/           # Real-time UI widgets & charts
│   │   ├── hooks/                # Metric polling & lifecycle hooks
│   │   └── types/                # System metric TypeScript interfaces
│   └── package.json
│
├── backend/                      # .NET 10 API Solution
│   └── SystemMonitor.Api/
│       ├── Endpoints/             # System, native & analytics HTTP endpoints
│       ├── interface/             # ISystemInfoProvider contract & DTOs
│       ├── Native/                # P/Invoke bridge bindings
│       └── services/              # Linux & Windows providers, background sampler, snapshot logger
│
├── native/                       # Low-level Native Engine
│   ├── include/                  # C++ Header declarations
│   ├── src/                      # Hardware & thermal sensors implementations
│   └── CMakeLists.txt
│
├── assembly/                     # x86-64 Assembly Workloads (NASM)
│
├── analytics/                    # Python analytics: stats, trend, bottleneck
│   │                              detection, and the FastAPI service exposing them
│
└── PROJECT_STATUS.md             # Detailed engineering build log
```

<br>

## 🧠 Philosophy

```
Build it from scratch.
Understand every boundary.
Do not hide underlying systems behind convenience libraries
when mastering the machine is the entire point.
```

<br>

---

<div align="center">

Released under the [MIT License](LICENSE).<br>
Crafted with curiosity, raw memory buffers, and assembly instructions.

</div>
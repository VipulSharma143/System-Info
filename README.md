# System Info — Multi-Language System Performance Monitor

A from-scratch system profiler and Task Manager, built to explore how monitoring tools actually work under the hood — not by wrapping libraries, but by reading raw kernel interfaces directly, writing custom native code, and even hand-crafting the performance-critical paths in x86-64 Assembly.

This isn't a typical "React dashboard" project. It's a five-language pipeline where every layer does real, non-trivial work:

**React (TypeScript) → .NET 10 (C#) → C++ → x86-64 Assembly (NASM)**

## Why this exists

Most system monitors either shell out to existing tools or wrap a metrics library. This project deliberately avoids that: CPU, memory, disk, network, and process data are read directly from Linux `/proc` and `/sys` (with a parallel Windows implementation via WMI/PerformanceCounter), a native C++ engine reads hardware sensors and does the same job in a compiled language for direct comparison, and the hottest code path — a CPU benchmark — is written and hand-optimized in raw Assembly, with a scalar-vs-SIMD comparison to prove it.

## Features

- **Live system dashboard** — CPU %, RAM usage, disk usage, network throughput, and a real process list, refreshing every 2 seconds
- **Cross-platform backend** — a clean `ISystemInfoProvider` abstraction with independent Linux and Windows implementations, chosen automatically at startup
- **Native C++ engine** — hardware reads (CPU model, temperature, GPU vendor detection) called from C# via P/Invoke, proving a full managed-to-native interop pipeline
- **Vendor-aware GPU detection** — dynamically scans `/sys/class/drm`, dispatches to vendor-specific logic (NVIDIA/AMD/Intel), and degrades gracefully instead of crashing on unsupported hardware
- **Hand-written x86-64 Assembly** — a real CPU benchmark loop, plus a second SIMD (SSE2) implementation of the same workload for a genuine optimized-vs-scalar performance comparison
- **Graceful hardware degradation throughout** — fan sensors, GPU usage, and other hardware-dependent features report "unavailable" honestly rather than faking data

## Tech stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React + TypeScript (Vite) | Live dashboard, polling, rendering |
| Backend | C# / .NET 10 | REST API, cross-platform orchestration |
| Native engine | C++ (CMake) | Low-level hardware reads, native interop |
| Performance layer | x86-64 Assembly (NASM) | CPU benchmarking, SIMD experiments |
| *(planned)* | Python | Historical analysis, bottleneck detection |
| *(planned)* | PostgreSQL | Performance history, benchmark storage |

## Getting started

**Prerequisites:** .NET 10 SDK, Node.js 20+, CMake, NASM, GCC/G++ (Linux) or MSVC (Windows).

Backend:

    cd backend/SystemMonitor.Api
    dotnet run

Native engine (Linux build shown; see native/CMakeLists.txt):

    cd native/build
    cmake ..
    make
    cp libsystemmonitor_native.so ../../backend/SystemMonitor.Api/

Frontend:

    cd frontend
    npm install
    npm run dev

Open `http://localhost:5173`.

## Project status

Actively in development, built in deliberate stages — each layer is proven working before the next is added. See [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) for a detailed phase-by-phase build log.

**Completed:** environment setup · React↔.NET pipeline · live system monitoring · C++ native engine · hardware monitoring (CPU temp, vendor-aware GPU, fan detection) · x86-64 Assembly benchmarks (scalar + SIMD) · Linux/Windows cross-platform backend abstraction

**Planned:** Python analytics layer · PostgreSQL historical storage · advanced dashboard (historical graphs, benchmark history) · Windows support for the native C++/Assembly layer

## Philosophy

> Build it slowly. Understand every layer. Don't hide complexity behind libraries when learning the underlying concept is useful.

## License

MIT

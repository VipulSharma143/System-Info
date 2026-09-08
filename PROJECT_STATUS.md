📋 Project Status & Build Log

This document tracks the phase-by-phase development progress, architectural decisions, and verification steps for the System Info performance monitoring engine.

🚦 Phase Overview
Phase	Milestone	Layer / Tech	Status
01	Toolchain & Scaffold Setup	.NET 10, React, CMake, NASM	✅ Completed
02	Full-Stack Interop Pipeline	React ↔ C# REST API	✅ Completed
03	Linux Kernel Metrics Engine	/proc & /sys Parser	✅ Completed
04	Native Hardware Interop	C++20 / P/Invoke FFI	✅ Completed
05	Vendor-Aware GPU & Fan Parsing	/sys/class/drm & /sys/class/hwmon	✅ Completed
06	x86-64 Assembly Benchmark	NASM (Scalar vs. SSE2 SIMD)	✅ Completed
07	Cross-Platform Abstraction	ISystemInfoProvider	✅ Completed
08	Analytics & Anomaly Detection	Python Engine	🟡 In Progress
09	Telemetry Persistence	PostgreSQL Storage	⚪ Planned
🔍 Detailed Phase Log
✅ Phase 1: Toolchain & Scaffolding
Set up the multi-language repository structure.
Configured build pipelines for:
.NET 10 SDK
Node 20+
CMake 3.20+
NASM
Verified the native compilation toolchain:
GCC/G++ on Linux
MSVC compatibility on Windows.
✅ Phase 2: React ↔ .NET 10 Pipeline
Built the initial REST controller endpoints in ASP.NET Core.
Created the React + TypeScript frontend using Vite.
Implemented real-time polling with a 2-second heartbeat interval.
✅ Phase 3: Raw Linux Kernel Metric Parser
No wrapper libraries: Used direct /proc and /sys readers.
Parsed /proc/stat for multi-core CPU usage calculations.
Parsed /proc/meminfo for:
Active memory
Free memory
Available memory
Buffered memory
Scanned /proc/[pid]/ for the real-time process list and per-process memory statistics.
Monitored network throughput using /proc/net/dev.
Monitored disk operations using /proc/diskstats.
✅ Phase 4: Native C++ Engine (P/Invoke Bridge)
Built the shared native library:
libsystemmonitor_native.so

Used CMake to build the native C++20 layer.
Established C# ↔ C++ communication through P/Invoke.
Extracted:
CPU model information
Package temperatures
Core temperature zones
✅ Phase 5: Dynamic GPU & Fan Sensor Discovery
Implemented automatic hardware path discovery using:
/sys/class/drm
/sys/class/hwmon

Added vendor-aware handling for:
NVIDIA
AMD
Intel
Added fallback handling for unavailable or unsupported sensors.
Virtual machines, headless servers, and unsupported hardware return clean "unavailable" indicators instead of crashing.
✅ Phase 6: x86-64 Assembly Benchmark Engine
Hand-wrote a compute-intensive CPU benchmark using NASM x86-64 assembly.
Implemented two execution paths for performance comparison:
Scalar Routine

Uses general-purpose registers:

RAX, RCX, RDX

SIMD Routine

Uses SSE2 vector registers:

XMM0–XMM7

Integrated the NASM routines into the C++ native layer.
Exposed benchmark execution time to the dashboard.
✅ Phase 7: Cross-Platform Provider Abstraction
Designed the ISystemInfoProvider interface to separate platform-specific system metrics from the rest of the application.
Implemented:
LinuxSystemInfoProvider


using direct Linux kernel filesystem readers.

Implemented:
WindowsSystemInfoProvider


using WMI and PerformanceCounter classes.

Added runtime OS detection in Program.cs to automatically select the appropriate provider.
🔮 Upcoming Phases
🟡 Phase 8: Python Analytics Layer

Status: In Progress

 Lightweight daemon/script for statistical trend calculation.
 Automated bottleneck detection:
CPU thermal throttling
High I/O wait states
 Anomaly detection for:
Runaway memory usage/leaks
Zombie processes
⚪ Phase 9: Persistent Storage & Historical Trends

Status: Planned

 PostgreSQL schema for historical system snapshots.
 Benchmark comparison database for Scalar vs. SIMD runs.
 Frontend interactive charts for long-term telemetry trends.
🧪 Verification & Testing Checklist
 Backend runs successfully on Linux using dotnet run.
 Native library compiles with zero warnings under GCC using -Wall -Wextra.
 NASM routines assemble to valid ELF64 / Win64 object formats.
 Frontend builds successfully without TypeScript compiler errors using tsc --noEmit.
 Metric polling gracefully recovers when the backend is temporarily restarted.

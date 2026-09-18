import { isTauri } from './tauri';

// The one place the backend's base URL is decided. Previously each hook
// (useSystemMetrics/useAnalytics/useSystemInfo) duplicated this same
// three-line comment and constant — spec section 22 asks for exactly one
// centralized place instead, so a fourth call site (or a change to how any
// of these modes resolves the backend) doesn't mean hunting down copies.
//
// Three environments this frontend bundle actually runs in:
//
//   1. `npm run dev` (Vite dev server, import.meta.env.DEV) — backend runs
//      separately via `dotnet run` on its fixed dev port.
//   2. Tauri desktop app — the window loads the bundled frontend from a
//      `tauri://` origin, which is NOT the backend's origin, so relative
//      URLs can't reach it. Tauri's Rust side always starts the backend on
//      a fixed port (see src-tauri/src/process.rs) specifically so the
//      frontend can address it with a fixed, known URL here.
//   3. Embedded in the backend's own wwwroot, opened in a browser by the
//      legacy launcher (launcher/Program.cs) — same-origin, so a relative
//      path always reaches whatever port Kestrel actually bound to.
const DEV_BACKEND_URL = 'http://localhost:5132';
const TAURI_BACKEND_URL = 'http://127.0.0.1:5132';

export const API_BASE = import.meta.env.DEV
  ? DEV_BACKEND_URL
  : isTauri()
    ? TAURI_BACKEND_URL
    : '';

// How long the frontend keeps retrying quietly before treating a failed
// startup fetch as a real error. Chosen to exceed Tauri's own backend
// readiness wait (READY_TIMEOUT = 30s in src-tauri/src/process.rs) with
// headroom — that Rust code shows the window immediately and starts the
// backend on a background thread, so on a slow cold start the frontend can
// legitimately be polling an not-yet-listening backend for up to ~30
// seconds. Shared by useSystemMetrics, useSystemGpu, and useSystemInfo so
// their startup budgets can't drift out of sync with each other.
export const STARTUP_GRACE_MS = 35_000;
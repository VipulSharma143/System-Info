import { isTauri } from './tauri';

const DEV_BACKEND_URL = 'http://localhost:5132';
const TAURI_BACKEND_URL = 'http://127.0.0.1:5132';

// Vite dev server and the Tauri window both load the UI from an origin that is not the backend's, so they
// need an absolute URL (the Tauri shell always starts the backend on this fixed port). Served from the
// backend's own wwwroot, a relative path reaches whatever port Kestrel bound.
export const API_BASE = import.meta.env.DEV ? DEV_BACKEND_URL : isTauri() ? TAURI_BACKEND_URL : '';

// Exceeds the Tauri supervisor's backend readiness timeout (45 s, src-tauri/src/process.rs), so a
// startup error is only declared once the backend has genuinely failed to come up.
export const STARTUP_GRACE_MS = 50_000;

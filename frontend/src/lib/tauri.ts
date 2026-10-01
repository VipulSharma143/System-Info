// The same frontend/dist bundle runs two ways: inside the Tauri desktop
// app (production), and embedded in the backend's wwwroot / served by Vite
// and opened in a plain browser tab (development only). `isTauri()` is the one runtime check that tells the
// rest of the app which world it's in, so nothing else has to guess.
//
// `__TAURI_INTERNALS__` is injected into `window` by the Tauri webview
// itself before any of our JS runs (this is what `withGlobalTauri`/the
// `@tauri-apps/api` package ultimately checks internally too) — a plain
// browser tab never has it.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// The same frontend/dist bundle ships two ways: inside the Tauri desktop
// app, and (still, for now — see launcher/Program.cs's deprecation note)
// embedded in the backend's wwwroot and opened in a regular browser tab by
// the old C# launcher. `isTauri()` is the one runtime check that tells the
// rest of the app which world it's in, so nothing else has to guess.
//
// `__TAURI_INTERNALS__` is injected into `window` by the Tauri webview
// itself before any of our JS runs (this is what `withGlobalTauri`/the
// `@tauri-apps/api` package ultimately checks internally too) — a plain
// browser tab never has it.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

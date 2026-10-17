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

/**
 * Restarts the desktop app. The shell is told first, so the new process waits for this one to finish instead of
 * being turned away as a "second launch" (the app allows one running instance; see src-tauri/src/instance.rs).
 */
export async function relaunchApp(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await invoke('begin_restart');
  await relaunch();
}

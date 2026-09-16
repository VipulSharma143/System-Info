// The one place the frontend reads its own version from — never hardcode
// "2.0.0" (or any version string) anywhere else in JSX/TSX. The value comes
// from package.json at build time (see vite.config.ts) and is kept in sync
// with CHANGELOG.md, Tauri, and the installer by scripts/sync-version.mjs.
export const APP_VERSION: string = __APP_VERSION__;

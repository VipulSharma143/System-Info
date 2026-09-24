import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Single source of truth for the version shown in the UI (Sidebar footer)
// is package.json's "version" field, which scripts/sync-version.mjs keeps
// in lockstep with CHANGELOG.md/Tauri/the installer. Injected as a build-time
// constant rather than fetched at runtime so it's available even before the
// backend responds. See src/lib/version.ts.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'))

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [tailwindcss(), react()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version as string),
  },

  // Tauri-required dev server settings (https://v2.tauri.app/start/frontend/vite/):
  // the Tauri window's devUrl in tauri.conf.json is hardcoded to this exact
  // host/port, so the dev server must fail loudly (strictPort) instead of
  // silently moving to 5174 if 5173 is already taken.
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    // src/lib/changelog.ts imports ../CHANGELOG.md (repo root) as raw text so
    // the Updates tab always shows the real release notes. Vite's dev server
    // refuses files outside the frontend/ project root unless allowed here.
    fs: {
      allow: ['..'],
    },
    watch: {
      // Don't reload the webview because `cargo build` touched files under
      // src-tauri/target — that's Rust output, not frontend source.
      ignored: ['**/src-tauri/**'],
    },
  },
}))

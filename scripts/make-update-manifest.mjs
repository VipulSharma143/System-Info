#!/usr/bin/env node
// Builds `latest.json`, the static manifest tauri-plugin-updater reads to
// decide whether a newer SystemInfo exists and where to download it.
//
// Runs in the `release` job of .github/workflows/release.yml, after the
// installers have been signed (`tauri signer sign` writes <file>.sig next to
// each one). The app fetches
//   https://github.com/<repo>/releases/latest/download/latest.json
// (tauri.conf.json -> plugins.updater.endpoints); GitHub serves the file
// from whichever release is currently marked "latest".
//
// Platform keys: the updater looks for "<os>-<arch>-<bundle>" first and falls
// back to "<os>-<arch>". The bundle-specific keys let a .deb install receive
// the .deb while an AppImage install receives the AppImage, even though both
// are linux-x86_64.
//
// Usage:
//   node scripts/make-update-manifest.mjs \
//     --version 2.2.0 --repo VipulSharma143/System-Info --tag 2.2.0 \
//     --assets release-assets --out release-assets/latest.json

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

// Body of the "## [version]" section of CHANGELOG.md, heading line excluded —
// the same text release.yml publishes as the GitHub Release description.
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## ['));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

function findAsset(dir, pattern, label) {
  const matches = readdirSync(dir).filter((f) => pattern.test(f));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} in ${dir}, found ${matches.length}: ${matches.join(', ') || 'none'}`);
  }
  return matches[0];
}

function entry(dir, file, baseUrl) {
  const sigPath = join(dir, `${file}.sig`);
  if (!existsSync(sigPath)) throw new Error(`Missing signature file: ${sigPath}`);
  const signature = readFileSync(sigPath, 'utf-8').trim();
  if (!signature) throw new Error(`Signature file is empty: ${sigPath}`);
  return { signature, url: `${baseUrl}/${encodeURIComponent(file)}` };
}

function main() {
  const version = arg('version');
  const repo = arg('repo');
  const tag = arg('tag', version);
  const assets = arg('assets');
  const out = arg('out');
  const changelogPath = arg('changelog', join(ROOT, 'CHANGELOG.md'));

  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;

  const windows = entry(assets, findAsset(assets, /^SystemInfo-Setup\.exe$/, 'Windows installer'), baseUrl);
  const appImage = entry(assets, findAsset(assets, /\.AppImage$/, 'AppImage'), baseUrl);
  const deb = entry(assets, findAsset(assets, /\.deb$/, '.deb package'), baseUrl);

  const manifest = {
    version,
    notes: releaseNotes(readFileSync(changelogPath, 'utf-8'), version),
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': windows,
      'windows-x86_64-nsis': windows,
      'linux-x86_64': appImage,
      'linux-x86_64-appimage': appImage,
      'linux-x86_64-deb': deb,
    },
  };

  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${out} for ${version} (${Object.keys(manifest.platforms).length} platform entries).`);
}

// Only run when executed directly, so the notes extractor stays importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

#!/usr/bin/env node
// Single authoritative-version propagation (migration spec sections 34/41):
// run this once with the new version and it rewrites every place the app
// version is duplicated, instead of hand-editing five files per release.
//
// Usage:
//   node scripts/sync-version.mjs 2.0.1        # explicit version
//   node scripts/sync-version.mjs              # reads the top entry of
//                                               # CHANGELOG.md instead —
//                                               # this is what CI uses
//                                               # (release.yml already
//                                               # derives its own VERSION
//                                               # from CHANGELOG.md this
//                                               # same way for the release
//                                               # tag/notes, so this reuses
//                                               # that same source instead
//                                               # of inventing a second one)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

function versionFromChangelog() {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf-8');
  const match = changelog.match(/^## \[(\d+\.\d+\.\d+(?:\.\d+)?)\]/m);
  if (!match) {
    throw new Error("Could not find a '## [x.y.z]' entry in CHANGELOG.md.");
  }
  return match[1];
}

function main() {
  const arg = process.argv[2];
  const version = arg ?? versionFromChangelog();

  if (!SEMVER.test(version)) {
    throw new Error(`"${version}" doesn't look like a plain x.y.z version.`);
  }

  const fourPart = `${version}.0`;

  patchJsonField(join(ROOT, 'frontend/package.json'), version);
  patchJsonField(join(ROOT, 'frontend/src-tauri/tauri.conf.json'), version);
  patchCargoToml(join(ROOT, 'frontend/src-tauri/Cargo.toml'), version);
  patchDirectoryBuildProps(join(ROOT, 'Directory.Build.props'), version, fourPart);
  patchInnoSetupScript(join(ROOT, 'SystemInfo.iss'), version);

  console.log(`Synced version ${version} to package.json, tauri.conf.json, Cargo.toml, Directory.Build.props, SystemInfo.iss.`);
}

function patchJsonField(path, version) {
  const original = readFileSync(path, 'utf-8');
  const data = JSON.parse(original);
  data.version = version;
  // Preserve trailing newline style rather than letting JSON.stringify
  // silently strip it — keeps diffs to just the one changed field.
  const trailingNewline = original.endsWith('\n') ? '\n' : '';
  writeFileSync(path, JSON.stringify(data, null, 2) + trailingNewline);
}

function patchCargoToml(path, version) {
  const original = readFileSync(path, 'utf-8');
  const pattern = /^version = "[^"]*"/m;
  if (!pattern.test(original)) {
    throw new Error(`Could not find a top-level "version = ..." line in ${path}`);
  }
  writeFileSync(path, original.replace(pattern, `version = "${version}"`));
}

function patchDirectoryBuildProps(path, version, fourPart) {
  const original = readFileSync(path, 'utf-8');
  const patterns = [/<Version>[^<]*<\/Version>/, /<AssemblyVersion>[^<]*<\/AssemblyVersion>/, /<FileVersion>[^<]*<\/FileVersion>/];
  if (!patterns.every((p) => p.test(original))) {
    throw new Error(`Could not find <Version>/<AssemblyVersion>/<FileVersion> in ${path}`);
  }
  let updated = original.replace(patterns[0], `<Version>${version}</Version>`);
  updated = updated.replace(patterns[1], `<AssemblyVersion>${fourPart}</AssemblyVersion>`);
  updated = updated.replace(patterns[2], `<FileVersion>${fourPart}</FileVersion>`);
  writeFileSync(path, updated);
}

function patchInnoSetupScript(path, version) {
  const original = readFileSync(path, 'utf-8');
  const pattern = /#define MyAppVersion "[^"]*"/;
  if (!pattern.test(original)) {
    throw new Error(`Could not find "#define MyAppVersion ..." in ${path}`);
  }
  writeFileSync(path, original.replace(pattern, `#define MyAppVersion "${version}"`));
}

main();

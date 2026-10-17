
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
  patchPackageLock(join(ROOT, 'frontend/package-lock.json'), version);
  patchCargoLock(join(ROOT, 'frontend/src-tauri/Cargo.lock'), version);

  console.log(`Synced version ${version} to package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock, Directory.Build.props.`);
}

// The lockfiles repeat the app's own version; left alone they drift (npm and cargo rewrite them on the next install
// or build, producing a surprise diff). Only the app's own entries are touched, never a dependency.
function patchPackageLock(path, version) {
  const original = readFileSync(path, 'utf-8');
  const data = JSON.parse(original);
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version;
  writeFileSync(path, JSON.stringify(data, null, 2) + (original.endsWith('\n') ? '\n' : ''));
}

function patchCargoLock(path, version) {
  const original = readFileSync(path, 'utf-8');
  const pattern = /(name = "system-info"\r?\nversion = ")[^"]*(")/; // CRLF on Windows checkouts
  if (!pattern.test(original)) throw new Error(`Could not find the system-info package in ${path}`);
  writeFileSync(path, original.replace(pattern, `$1${version}$2`));
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

main();

#!/usr/bin/env node
// Build-time guardrail (migration spec section 40): fail the build clearly
// if any version-bearing file has drifted from CHANGELOG.md's current
// release, instead of silently shipping a mismatched build the way the
// pre-Tauri app shipped v1.0.0 in the UI against a v2.0.0 release.
//
// Run with no arguments; non-zero exit + a readable summary means "run
// `node scripts/sync-version.mjs` and commit the result" — see
// .github/workflows/release.yml's "Validate application version" step.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function versionFromChangelog() {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf-8');
  const match = changelog.match(/^## \[(\d+\.\d+\.\d+(?:\.\d+)?)\]/m);
  if (!match) throw new Error("Could not find a '## [x.y.z]' entry in CHANGELOG.md.");
  return match[1];
}

function readJsonField(path, field) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf-8'))[field];
}

function readByRegex(path, pattern, label) {
  const text = readFileSync(join(ROOT, path), 'utf-8');
  const match = text.match(pattern);
  if (!match) throw new Error(`Could not find ${label} in ${path}`);
  return match[1];
}

function main() {
  const expected = versionFromChangelog();

  const checks = [
    ['frontend/package.json', readJsonField('frontend/package.json', 'version')],
    ['frontend/src-tauri/tauri.conf.json', readJsonField('frontend/src-tauri/tauri.conf.json', 'version')],
    ['frontend/src-tauri/Cargo.toml', readByRegex('frontend/src-tauri/Cargo.toml', /^version = "([^"]*)"/m, 'version =')],
    ['Directory.Build.props', readByRegex('Directory.Build.props', /<Version>([^<]*)<\/Version>/, '<Version>')],
    ['SystemInfo.iss', readByRegex('SystemInfo.iss', /#define MyAppVersion "([^"]*)"/, 'MyAppVersion')],
  ];

  const mismatches = checks.filter(([, actual]) => actual !== expected);

  console.log(`Expected version (from CHANGELOG.md): ${expected}`);
  for (const [file, actual] of checks) {
    console.log(`  ${actual === expected ? 'OK  ' : 'FAIL'}  ${file} -> ${actual}`);
  }

  if (mismatches.length > 0) {
    console.error(
      `\nVersion mismatch in ${mismatches.length} file(s). Run:\n` +
        `  node scripts/sync-version.mjs ${expected}\n` +
        `and commit the result before releasing.`
    );
    process.exit(1);
  }

  console.log('\nAll version-bearing files agree.');
}

main();

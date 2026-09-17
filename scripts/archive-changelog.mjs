#!/usr/bin/env node
// Keeps CHANGELOG.md short and readable by moving everything except
// [Unreleased] and the N most recent released versions into
// CHANGELOG_ARCHIVE.md. Nothing is summarized or deleted — every moved
// section is the exact text that used to live in CHANGELOG.md, just
// relocated. Newest-first ordering is preserved in both files.
//
// This is a manual housekeeping step, same as sync-version.mjs/
// check-version.mjs — run it yourself whenever CHANGELOG.md starts
// feeling too long, typically right after cutting a release. It's safe
// to re-run any time: with fewer released versions than --keep, it's a
// no-op.
//
// scripts/check-version.mjs and .github/workflows/release.yml both read
// the *top* "## [x.y.z]" entry in CHANGELOG.md to determine the current
// version — this script never removes that entry (Unreleased is always
// kept, and --keep defaults to 2, so the latest release always stays),
// so neither of those break.
//
// Usage:
//   node scripts/archive-changelog.mjs            # keep 2 latest versions (default)
//   node scripts/archive-changelog.mjs --keep 3    # keep N latest versions

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');
const ARCHIVE_PATH = join(ROOT, 'CHANGELOG_ARCHIVE.md');

const ARCHIVE_HEADER = `# Changelog Archive

Older SystemInfo release notes, split out of CHANGELOG.md to keep that
file short and readable. Newest entries are at the top here too.
Nothing below has been summarized or altered — every section is the
exact text that used to live in CHANGELOG.md before it aged out.

See CHANGELOG.md for the current and most recent releases.

`;

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--keep');
  const keep = i !== -1 ? parseInt(args[i + 1], 10) : 2;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error('--keep must be a positive integer, e.g. --keep 3');
  }
  return keep;
}

// Splits a changelog file's body into { intro, sections }, where each
// section is the raw text of one "## [...]" block: its heading line
// through to (but not including) the next "## [" heading, or EOF.
function splitSections(text) {
  const headingRe = /^## \[.+\].*$/gm;
  const matches = [...text.matchAll(headingRe)];

  if (matches.length === 0) {
    return { intro: text, sections: [] };
  }

  const intro = text.slice(0, matches[0].index);
  const sections = matches.map((m, i) => {
    const start = m.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    // Normalize trailing whitespace per section; spacing between
    // sections is re-applied uniformly when the files are reassembled.
    return text.slice(start, end).replace(/\s+$/, '') + '\n\n\n';
  });

  return { intro, sections };
}

function versionOf(section) {
  const m = section.match(/^## \[(.+?)\]/);
  return m ? m[1] : null;
}

function main() {
  const keep = parseArgs();

  if (!existsSync(CHANGELOG_PATH)) {
    throw new Error(`CHANGELOG.md not found at ${CHANGELOG_PATH}`);
  }

  const changelog = readFileSync(CHANGELOG_PATH, 'utf-8');
  const { intro, sections } = splitSections(changelog);

  const unreleasedIdx = sections.findIndex((s) => versionOf(s) === 'Unreleased');
  const unreleased = unreleasedIdx !== -1 ? [sections[unreleasedIdx]] : [];
  const releaseSections = sections.filter((_, i) => i !== unreleasedIdx);

  if (releaseSections.length <= keep) {
    console.log(
      `CHANGELOG.md has ${releaseSections.length} released version(s), at or under --keep ${keep} — nothing to archive.`
    );
    return;
  }

  const kept = releaseSections.slice(0, keep);
  const toArchive = releaseSections.slice(keep);

  // Rewrite CHANGELOG.md: intro + Unreleased + the kept releases.
  const newChangelog = (intro + [...unreleased, ...kept].join('')).replace(/\n{4,}/g, '\n\n\n');
  writeFileSync(CHANGELOG_PATH, newChangelog.trimEnd() + '\n');

  // Prepend the newly-archived sections above whatever's already in
  // CHANGELOG_ARCHIVE.md, so the archive stays newest-first too.
  let existingArchiveSections = [];
  if (existsSync(ARCHIVE_PATH)) {
    existingArchiveSections = splitSections(readFileSync(ARCHIVE_PATH, 'utf-8')).sections;
  }
  const newArchive = (ARCHIVE_HEADER + [...toArchive, ...existingArchiveSections].join('')).replace(
    /\n{4,}/g,
    '\n\n\n'
  );
  writeFileSync(ARCHIVE_PATH, newArchive.trimEnd() + '\n');

  console.log(`CHANGELOG.md now holds: Unreleased + ${kept.map(versionOf).join(', ')}`);
  console.log(`Moved to CHANGELOG_ARCHIVE.md: ${toArchive.map(versionOf).join(', ')}`);
}

main();

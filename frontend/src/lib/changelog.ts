// Release notes shown in the Updates tab. CHANGELOG.md (repo root) is the
// single source of truth for them — the same file release.yml reads the
// version from and publishes as the GitHub Release body — so the in-app
// "what changed" text can never drift from what was actually released.
//
// Imported with Vite's `?raw` suffix: the file's text is embedded in the JS
// bundle at build time (no runtime file access, works inside Tauri and in a
// plain browser tab alike). The archive is loaded lazily, only if the user
// asks for older releases.
import changelogRaw from '../../../CHANGELOG.md?raw';

export interface ReleaseEntry {
  version: string;
  date?: string;
  body: string;
}

const HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/;

export function parseChangelog(raw: string): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  let current: { version: string; date?: string; lines: string[] } | null = null;

  const flush = () => {
    if (current && current.version.toLowerCase() !== 'unreleased') {
      const body = current.lines.join('\n').trim();
      if (body) entries.push({ version: current.version, date: current.date, body });
    }
  };

  for (const line of raw.split(/\r?\n/)) {
    const match = HEADING.exec(line);
    if (match) {
      flush();
      current = { version: match[1], date: match[2], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return entries;
}

export const RECENT_RELEASES: ReleaseEntry[] = parseChangelog(changelogRaw);

export async function loadArchivedReleases(): Promise<ReleaseEntry[]> {
  const mod = await import('../../../CHANGELOG_ARCHIVE.md?raw');
  return parseChangelog(mod.default);
}

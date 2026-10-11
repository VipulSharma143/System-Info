#!/usr/bin/env node
// Fetches the official PawnIO installer into the backend resources so the Windows build can set up the CPU sensor driver
// itself (see backend services/Cpu/SensorDriverInstaller.cs). The file is downloaded from the project's own GitHub release
// and refused unless its SHA-256 equals the pinned value (the same value winget publishes for this version).
// Usage: node scripts/fetch-pawnio.mjs [destinationDir]   (default: frontend/src-tauri/resources/backend/drivers)
// Updating PawnIO: change VERSION and SHA256 here and BundledSha256 in SensorDriverInstaller.cs together.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.2.0';
const SHA256 = '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032';
const URL = `https://github.com/namazso/PawnIO.Setup/releases/download/${VERSION}/PawnIO_setup.exe`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = resolve(process.argv[2] ?? join(root, 'frontend', 'src-tauri', 'resources', 'backend', 'drivers'));
const dest = join(destDir, 'PawnIO_setup.exe');
const sha = (buf) => createHash('sha256').update(buf).digest('hex').toUpperCase();

const csharp = readFileSync(join(root, 'backend', 'SystemMonitor.Api', 'services', 'Cpu', 'SensorDriverInstaller.cs'), 'utf8');
if (!csharp.includes(`"${SHA256}"`)) {
  console.error('SHA-256 here and BundledSha256 in SensorDriverInstaller.cs differ; update both together.');
  process.exit(1);
}

if (existsSync(dest) && sha(readFileSync(dest)) === SHA256) {
  console.log(`PawnIO ${VERSION} installer already present and verified: ${dest}`);
  process.exit(0);
}

const response = await fetch(URL, { redirect: 'follow' });
if (!response.ok) {
  console.error(`Download failed: HTTP ${response.status} for ${URL}`);
  process.exit(1);
}
const data = Buffer.from(await response.arrayBuffer());
if (sha(data) !== SHA256) {
  console.error(`Refusing the download: SHA-256 is ${sha(data)}, expected ${SHA256}.`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
writeFileSync(dest, data);
console.log(`PawnIO ${VERSION} installer verified and saved: ${dest} (${data.length} bytes)`);

// A stand-in backend for testing scripts/measure-startup.mjs without the real app: /health at once, /api/system/info
// slow (400 ms) unless a cache file exists in SYSTEM_INFO_DATA_DIR (it writes one the first time).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.SYSTEM_INFO_DATA_DIR;
const port = Number(new URL(process.env.ASPNETCORE_URLS).port);
const cacheFile = dir ? join(dir, 'cache.json') : null;

createServer((req, res) => {
  const send = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); };
  if (req.url === '/api/system/info') {
    if (cacheFile && existsSync(cacheFile)) return send();
    setTimeout(() => { if (cacheFile) { mkdirSync(dir, { recursive: true }); writeFileSync(cacheFile, '{}'); } send(); }, 400);
    return;
  }
  send();
}).listen(port, '127.0.0.1');

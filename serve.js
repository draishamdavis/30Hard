// Local development server: static files plus the account API backed by an in-memory store.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, memoryStores } from './netlify/lib/core.mts';

const PORT = process.env.PORT || 8080;
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const api = createApi(memoryStores(), { secret: process.env.SESSION_SECRET, googleClientId: process.env.GOOGLE_CLIENT_ID });

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function handleApi(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await api(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { handleApi(req, res).catch(() => { res.writeHead(500); res.end(); }); return; }
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(DIR, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
  if (!filePath.startsWith(DIR + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`30 HARD running at http://localhost:${PORT}`));

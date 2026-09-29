// Zero-dependency local server: `npm start`, then open http://127.0.0.1:8080/.
// Serves public/ plus docs/RESEARCH.md (the page links to it), nothing else.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pub = join(root, 'public');
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };

createServer(async (req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('bad path'); }
  const file = rel === '/docs/RESEARCH.md' ? join(root, 'docs', 'RESEARCH.md') : normalize(join(pub, rel.endsWith('/') ? rel + 'index.html' : rel));
  if (file !== join(root, 'docs', 'RESEARCH.md') && !file.startsWith(pub + sep)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, host, () => console.log(`Catan Lens on http://${host}:${port}/`));

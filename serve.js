// Zero-dependency local server: `npm start`, then open http://127.0.0.1:8080/.
// Serves public/ plus docs/RESEARCH.md (the page links to it), nothing else.
import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pub = join(root, 'public');
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };

createServer(async (req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('bad path'); }
  const file = rel === '/docs/RESEARCH.md' ? join(root, 'docs', 'RESEARCH.md') : normalize(join(pub, rel.endsWith('/') ? rel + 'index.html' : rel));
  if (file !== join(root, 'docs', 'RESEARCH.md') && !file.startsWith(pub + sep)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const input = await open(file);
    try {
      const info = await input.stat();
      if (!info.isFile()) { res.writeHead(404); return res.end('not found'); }
      const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
      let start = 0, end = info.size - 1, status = 200;
      // No validators are issued: conditional or unsupported ranges receive the whole file.
      const range = req.method === 'GET' && !req.headers['if-range'] && /^bytes=(\d*)-(\d*)$/i.exec((req.headers.range || '').trim());
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(end, Number(range[2]));
        } else start = Math.max(0, info.size - Number(range[2]));
        if (start > end || start >= info.size) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}`, 'Content-Length': 0 });
          return res.end();
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = end - start + 1;
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || info.size === 0) return res.end();
      await pipeline(input.createReadStream({ start, end, autoClose: false }), res);
    } finally { await input.close(); }
  } catch {
    if (res.headersSent || res.destroyed) return res.destroy();
    res.writeHead(404); res.end('not found');
  }
}).listen(port, host, () => console.log(`Catan Lens on http://${host}:${port}/`));

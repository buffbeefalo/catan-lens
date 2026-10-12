// Draws synthetic boards with known tiles, numbers and token positions for test/imageread.test.js:
// `node scripts/make-board-fixtures.cjs`. Development only: Playwright's Chromium (CHROMIUM_PATH picks a build)
// draws each board as SVG and applies real JPEG compression; the photo distortions are plain JS with a known
// perspective map, so every token centre in the truth file is exact. Writes test/fixtures/imageread/.
//
// Looks: app (Catan Lens itself, colours read from public/style.css, light and dark theme), flat (another
// online renderer: different palette, smaller bold tokens, dark outlines, a robber and pieces), photo (a
// printed board with texture and pieces, then tilted, unevenly lit, blurred, noisy and JPEG-compressed) and
// unseen (colours no Catan board uses, to check that the reader admits it is guessing).
const { chromium } = require('playwright');
const { deflateSync, constants } = require('node:zlib');
const { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test', 'fixtures', 'imageread');
const NAMES = { wood: 'Wood', brick: 'Brick', wheat: 'Wheat', sheep: 'Sheep', ore: 'Ore', desert: 'Desert' };

// Which boards to draw: [look, setup, seed, options]. Seeds differ so no two images share a board.
// Scale is picture pixels per board unit (one tile is about 1.7 units across); tokens come out about 12 to 22 pixels
// in radius, smaller than most real screenshots, so the reader is tested on the hard side.
const PLAN = [
  ['app', 'base', 1, { theme: 'light', scale: 56 }], ['app', 'base', 2, { theme: 'dark', scale: 52 }], ['app', 'ext56', 4, { theme: 'dark', scale: 46 }],
  ['flat', 'base', 5, { scale: 52 }], ['flat', 'ext56', 7, { scale: 46 }], ['flat', 'ext56', 8, { scale: 44 }],
  ['photo', 'base', 9, { scale: 96 }], ['photo', 'base', 10, { scale: 90 }], ['photo', 'ext56', 11, { scale: 84 }],
  ['unseen', 'base', 13, { theme: 'light', scale: 52 }],
];

// ---- colours ---------------------------------------------------------------------------------------------
function cssTokens() {
  const css = readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  const block = sel => { const i = css.indexOf(sel + '{'); return css.slice(i + sel.length + 1, css.indexOf('}', i)); };
  const vars = text => Object.fromEntries([...text.matchAll(/--([\w-]+):([^;]+)/g)].map(m => [m[1], m[2].trim()]));
  const light = vars(block(':root'));
  return { light, dark: { ...light, ...vars(block(':root[data-theme="dark"]')) } };
}

function look(name, theme, css) {
  const t = css[theme || 'light'];
  const app = {
    bg: t.bg, hexStroke: t.grout, hexStrokeWidth: 0.06,
    tiles: { wood: t.wood, brick: t.brick, wheat: t.wheat, sheep: t.sheep, ore: t.ore, desert: t.desert },
    label: { font: t.ui, size: 0.18, dy: 0.65, fill: t['hex-ink'] },
    token: { r: 0.36, fill: t.disc, stroke: t['disc-line'], strokeWidth: 0.03, font: t.disp, weight: 600, size: 0.42, dy: 0.1, ink: t['disc-ink'], red: t['disc-red'], pipR: 0.03, pipGap: 0.09, pipDy: 0.24 },
    harbour: { kind: 'label', ink: t.mut, line: t.line2, font: t.ui },
  };
  if (name === 'app') return app;
  if (name === 'unseen') return { ...app, tiles: { wood: '#4b2e83', brick: '#3b6fd4', wheat: '#e26fd0', sheep: '#8fa8ff', ore: '#1e2f5c', desert: '#c9b8ff' } };
  if (name === 'flat') return {
    bg: '#2b6aa3', hexStroke: '#2d2a22', hexStrokeWidth: 0.035,
    tiles: { wood: '#2c6438', brick: '#b04a2a', wheat: '#e6b52f', sheep: '#8cc152', ore: '#9aa0ae', desert: '#dcc48a' },
    token: { r: 0.3, fill: '#f6e7c4', stroke: '#5a4a32', strokeWidth: 0.025, font: "'DejaVu Sans','Liberation Sans',Arial,sans-serif", weight: 700, size: 0.3, dy: 0.07, ink: '#202020', red: '#d0161c', pipR: 0.024, pipGap: 0.064, pipDy: 0.185 },
    robber: '#3b3b3b', pieces: true, harbour: { kind: 'disc', fill: '#f6e7c4', ink: '#202020', line: '#d9c7a0', font: "'DejaVu Sans',sans-serif" },
  };
  return {   // photo: a printed board
    bg: '#2f5f8a', hexStroke: '#c9b88f', hexStrokeWidth: 0.03, texture: true,
    tiles: { wood: '#36552a', brick: '#b65f39', wheat: '#d6ae3c', sheep: '#9fc45a', ore: '#80868d', desert: '#d8c08c' },
    token: { r: 0.32, fill: '#eee0c0', stroke: '#b9a77f', strokeWidth: 0.015, shadow: true, font: "'DejaVu Serif',serif", weight: 700, size: 0.34, dy: 0.08, ink: '#1c1a17', red: '#b3262b', pipR: 0.03, pipGap: 0.08, pipDy: 0.205 },
    robber: '#2e2e30', pieces: true, harbour: { kind: 'disc', fill: '#e9dcc0', ink: '#1c1a17', line: '#d8c8a2', font: "'DejaVu Serif',serif" },
  };
}

// ---- drawing ---------------------------------------------------------------------------------------------
function boardSvg(lib, board, lk, scale, seed) {
  const { hexCorners, PIPS, rng } = lib, g = board.graph;
  const xs = g.vertices.map(v => v.x), ys = g.vertices.map(v => v.y), pad = 0.8;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const width = Math.ceil((Math.max(...xs) + pad - minX) * scale), height = Math.ceil((Math.max(...ys) + pad - minY) * scale);
  const f = n => +n.toFixed(4);
  const out = [`<rect x="${minX}" y="${minY}" width="${width / scale}" height="${height / scale}" fill="${lk.bg}"/>`];
  const rand = rng(seed * 7919 + 17);
  for (const h of board.hexes) {
    out.push(`<polygon points="${hexCorners(h.x, h.y).map(p => p.map(f).join(',')).join(' ')}" fill="${lk.tiles[h.resource]}" stroke="${lk.hexStroke}" stroke-width="${lk.hexStrokeWidth}"/>`);
    if (lk.texture) for (let k = 0; k < 18; k++) {   // printed tile art: soft blobs a little lighter or darker than the tile
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.62, shade = 0.82 + rand() * 0.32;
      const rgb = lk.tiles[h.resource].match(/\w\w/g).map(x => Math.min(255, Math.round(parseInt(x, 16) * shade)));
      out.push(`<ellipse cx="${f(h.x + Math.cos(a) * d)}" cy="${f(h.y + Math.sin(a) * d)}" rx="${f(0.05 + rand() * 0.12)}" ry="${f(0.04 + rand() * 0.08)}" transform="rotate(${Math.round(rand() * 180)} ${f(h.x + Math.cos(a) * d)} ${f(h.y + Math.sin(a) * d)})" fill="rgb(${rgb})" opacity="0.8"/>`);
    }
    if (lk.label) out.push(`<text x="${f(h.x)}" y="${f(h.y + lk.label.dy)}" font-family="${lk.label.font}" font-weight="600" font-size="${lk.label.size}" text-anchor="middle" fill="${lk.label.fill}">${NAMES[h.resource]}</text>`);
    if (h.resource === 'desert' && lk.robber && h === board.hexes.find(d => d.resource === 'desert')) out.push(`<ellipse cx="${f(h.x)}" cy="${f(h.y + 0.1)}" rx="0.16" ry="0.22" fill="${lk.robber}"/><circle cx="${f(h.x)}" cy="${f(h.y - 0.17)}" r="0.11" fill="${lk.robber}"/>`);
    if (!h.number) continue;
    const t = lk.token, red = h.number === 6 || h.number === 8, ink = red ? t.red : t.ink;
    if (t.shadow) out.push(`<circle cx="${f(h.x + 0.025)}" cy="${f(h.y + 0.035)}" r="${t.r + 0.01}" fill="rgba(0,0,0,.28)"/>`);
    out.push(`<circle cx="${f(h.x)}" cy="${f(h.y)}" r="${t.r}" fill="${t.fill}" stroke="${t.stroke}" stroke-width="${t.strokeWidth}"/>`);
    out.push(`<text x="${f(h.x)}" y="${f(h.y + t.dy)}" font-family="${t.font}" font-weight="${t.weight}" font-size="${t.size}" text-anchor="middle" fill="${ink}">${h.number}</text>`);
    const n = PIPS[h.number];
    for (let i = 0; i < n; i++) out.push(`<circle cx="${f(h.x + (i - (n - 1) / 2) * t.pipGap)}" cy="${f(h.y + t.pipDy)}" r="${t.pipR}" fill="${ink}"/>`);
  }
  for (const [eid, type] of Object.entries(board.harbors)) {   // harbours out at sea, as each look draws them
    const e = g.edges[eid], [a, b] = e.v.map(i => g.vertices[i]), own = board.hexes[e.hexes[0]];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(mx - own.x, my - own.y), nx = (mx - own.x) / len, ny = (my - own.y) / len;
    const text = type === '3:1' ? '3:1' : `2:1 ${type}`, hb = lk.harbour;
    if (hb.kind === 'label') {
      out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${hb.line}" stroke-width="0.05" stroke-dasharray="0.1 0.08"/>`);
      out.push(`<text x="${f(mx + nx * 0.42)}" y="${f(my + ny * 0.42 + 0.08)}" font-family="${hb.font}" font-weight="600" font-size="0.22" text-anchor="middle" fill="${hb.ink}">${text}</text>`);
    } else {
      const cx = mx + nx * 0.42, cy = my + ny * 0.42;
      out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(cx)}" y2="${f(cy)}" stroke="${hb.line}" stroke-width="0.06"/><line x1="${f(b.x)}" y1="${f(b.y)}" x2="${f(cx)}" y2="${f(cy)}" stroke="${hb.line}" stroke-width="0.06"/>`);
      out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="0.2" fill="${hb.fill}"/><text x="${f(cx)}" y="${f(cy + 0.05)}" font-family="${hb.font}" font-weight="700" font-size="0.13" text-anchor="middle" fill="${hb.ink}">${type === '3:1' ? '3:1' : '2:1'}</text>`);
    }
  }
  if (lk.pieces) {   // a few settlements and roads already placed, as in a game in progress
    const pick = rng(seed * 31 + 5), colours = ['#d23c3c', '#2f5fd0', '#f2f2f2'];
    colours.forEach(c => {
      const v = g.vertices[Math.floor(pick() * g.vertices.length)], e = g.edges[v.edges[Math.floor(pick() * v.edges.length)]];
      const [p, q] = e.v.map(i => g.vertices[i]);
      out.push(`<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" stroke="#222" stroke-width="0.15" stroke-linecap="round"/><line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" stroke="${c}" stroke-width="0.09" stroke-linecap="round"/>`);
      const x = v.x, y = v.y;
      out.push(`<path d="M${f(x - 0.17)},${f(y + 0.15)} L${f(x - 0.17)},${f(y - 0.04)} L${f(x)},${f(y - 0.2)} L${f(x + 0.17)},${f(y - 0.04)} L${f(x + 0.17)},${f(y + 0.15)} Z" fill="${c}" stroke="#222" stroke-width="0.035"/>`);
    });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width / scale} ${height / scale}">${out.join('')}</svg>`;
  return { svg, width, height, toPx: (x, y) => [(x - minX) * scale, (y - minY) * scale] };
}

// ---- pixels ----------------------------------------------------------------------------------------------
// Image coordinates follow canvas convention: pixel i covers [i, i + 1), so its centre is at i + 0.5.
function bilinear(img, x, y, out) {
  const fx = Math.min(img.width - 1, Math.max(0, x - 0.5)), fy = Math.min(img.height - 1, Math.max(0, y - 0.5));
  const x0 = Math.min(img.width - 2, Math.floor(fx)), y0 = Math.min(img.height - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
  for (let c = 0; c < 3; c++) {
    const i = (y0 * img.width + x0) * 4 + c, w = img.width * 4, d = img.data;
    out[c] = (d[i] * (1 - tx) + d[i + 4] * tx) * (1 - ty) + (d[i + w] * (1 - tx) + d[i + w + 4] * tx) * ty;
  }
}

function solveHomography(src, dst) {   // independent of public/imageread.js on purpose: the truth must not share its code
  const A = [], b = [];
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  });
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j]; b[r] -= k * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return (x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
}

const LIN = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const SRGB = l => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055);

// A phone photo of the board: perspective tilt and a small turn, uneven warm or cool light with a vignette,
// slight blur and sensor noise, cropped to the board (`box`, in flat pixels) plus a margin. JPEG compression is
// applied afterwards in the browser.
function photograph(lib, flat, seed, box) {
  const rand = lib.rng(seed * 104729 + 3), j = s => (rand() * 2 - 1) * s;
  const W = Math.round(flat.width * 0.86), H = Math.round(flat.height * 0.8);
  const turn = j(0.07), cx = W / 2, cy = H / 2;
  const quad = [[0.15 + j(0.03), 0.05 + j(0.02)], [0.85 + j(0.03), 0.05 + j(0.02)], [0.99 + j(0.01), 0.95 + j(0.02)], [0.01 + j(0.01), 0.95 + j(0.02)]]
    .map(([u, v]) => { const x = u * W - cx, y = v * H - cy; return [cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)]; })
    .map(([x, y]) => [cx + (x - cx) * 0.92, cy + (y - cy) * 0.92]);
  const corners = [[0, 0], [flat.width, 0], [flat.width, flat.height], [0, flat.height]];
  const toPhoto = solveHomography(corners, quad), toFlat = solveHomography(quad, corners);
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const s = [0, 0, 0], acc = [0, 0, 0];
  const phi = rand() * Math.PI * 2, warm = rand() < 0.5, cast = warm ? [1.06, 1, 0.86] : [0.93, 1, 1.08];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    acc[0] = acc[1] = acc[2] = 0;
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const [fx, fy] = toFlat(x + dx, y + dy);
      if (fx < 0 || fy < 0 || fx > flat.width || fy > flat.height) { const grain = 8 * Math.sin(fx * 0.05 + Math.sin(fy * 0.013) * 3); s[0] = 92 + grain; s[1] = 66 + grain * 0.7; s[2] = 46 + grain * 0.5; }   // table
      else bilinear(flat, fx, fy, s);
      for (let c = 0; c < 3; c++) acc[c] += s[c] / 4;
    }
    const t = ((x / W - 0.5) * Math.cos(phi) + (y / H - 0.5) * Math.sin(phi)) + 0.5, rr = Math.hypot(x / W - 0.5, y / H - 0.5) / 0.7071;
    const gain = (1.12 - 0.38 * t) * (1 - 0.18 * rr * rr);
    const o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) img.data[o + c] = SRGB(LIN(acc[c]) * gain * cast[c]);
    img.data[o + 3] = 255;
  }
  blur(img, 0.85);
  for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) {   // Gaussian sensor noise (Box-Muller)
    const n = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    img.data[i + c] = img.data[i + c] + 2 * n;
  }
  const ends = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(([x, y]) => toPhoto(x, y)), m = 0.04 * W;
  const x0 = Math.max(0, Math.floor(Math.min(...ends.map(p => p[0])) - m)), x1 = Math.min(W, Math.ceil(Math.max(...ends.map(p => p[0])) + m));
  const y0 = Math.max(0, Math.floor(Math.min(...ends.map(p => p[1])) - m)), y1 = Math.min(H, Math.ceil(Math.max(...ends.map(p => p[1])) + m));
  const crop = { width: x1 - x0, height: y1 - y0, data: new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4) };
  for (let y = y0; y < y1; y++) crop.data.set(img.data.subarray((y * W + x0) * 4, (y * W + x1) * 4), (y - y0) * crop.width * 4);
  return { img: crop, toPhoto: (x, y) => { const [u, v] = toPhoto(x, y); return [u - x0, v - y0]; } };
}

function blur(img, sigma) {
  const r = Math.ceil(sigma * 3), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0), w = img.width, h = img.height, src = Float32Array.from(img.data), tmp = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    const from = pass ? tmp : src, to = pass ? img.data : tmp;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let i = -r; i <= r; i++) {
        const xx = pass ? x : Math.min(w - 1, Math.max(0, x + i)), yy = pass ? Math.min(h - 1, Math.max(0, y + i)) : y;
        v += from[(yy * w + xx) * 4 + c] * k[i + r];
      }
      to[(y * w + x) * 4 + c] = v / sum;
    }
  }
}

async function jpegRoundTrip(page, img, quality) {
  const b64 = await page.evaluate(async ({ data, width, height, quality }) => {
    const bytes = Uint8ClampedArray.from(atob(data), ch => ch.charCodeAt(0));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(bytes, width, height), 0, 0);
    const pic = new Image(); pic.src = canvas.toDataURL('image/jpeg', quality); await pic.decode();
    ctx.clearRect(0, 0, width, height); ctx.drawImage(pic, 0, 0);
    const out = ctx.getImageData(0, 0, width, height).data;
    let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  }, { data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length).toString('base64'), width: img.width, height: img.height, quality });
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) };
}

// Small PNG writer: 8-bit RGB, the best of the five row filters per row, maximum deflate.
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, body) {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
function encodePng({ width, height, data }) {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  const tries = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) cur[x * 3 + c] = data[(y * width + x) * 4 + c];
    let best = 0, bestCost = Infinity;
    for (let f = 0; f < 5; f++) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? cur[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0, q = a + b - c;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : Math.abs(q - a) <= Math.abs(q - b) && Math.abs(q - a) <= Math.abs(q - c) ? a : Math.abs(q - b) <= Math.abs(q - c) ? b : c;
        const v = (cur[i] - p) & 255; tries[f][i] = v; cost += v < 128 ? v : 256 - v;
      }
      if (cost < bestCost) { bestCost = cost; best = f; }
    }
    raw[y * (stride + 1)] = best; tries[best].copy(raw, y * (stride + 1) + 1);
    [prev, cur] = [cur, prev];
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const packed = [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED].map(strategy => deflateSync(raw, { level: 9, memLevel: 9, strategy })).sort((a, b) => a.length - b.length)[0];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', packed), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const imp = file => import(pathToFileURL(path.join(ROOT, file)).href);
  const [{ generateBoard, PIPS, rng }, { hexCorners }, { decodePng }] = await Promise.all([imp('public/board.js'), imp('public/geometry.js'), imp('test/png.js')]);
  const lib = { hexCorners, PIPS, rng }, css = cssTokens();
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith('.png') || f === 'truth.json') unlinkSync(path.join(OUT, f));
  // Greyscale text smoothing, as phone screenshots have (coloured subpixel fringes only add bytes).
  const browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const truth = [];
  let bytes = 0;
  for (const [style, setup, seed, opt] of PLAN) {
    const board = generateBoard({ setup, seed });
    const lk = look(style, opt.theme, css), drawn = boardSvg(lib, board, lk, opt.scale, seed);
    await page.setViewportSize({ width: drawn.width, height: drawn.height });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}svg{display:block}</style></head><body>${drawn.svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    let img = decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: drawn.width, height: drawn.height } }));
    let toImage = drawn.toPx;
    if (style === 'photo') {
      const corners = board.graph.vertices.map(v => drawn.toPx(v.x, v.y));
      const box = [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))];
      const shot = photograph(lib, img, seed, box);
      img = await jpegRoundTrip(page, shot.img, 0.6);
      toImage = (x, y) => shot.toPhoto(...drawn.toPx(x, y));
    }
    const file = `${style}-${setup}-${seed}.png`, png = encodePng(img);
    writeFileSync(path.join(OUT, file), png); bytes += png.length;
    const hexes = board.hexes.map(h => { const [x, y] = toImage(h.x, h.y); return { resource: h.resource, number: h.number, x: +x.toFixed(2), y: +y.toFixed(2) }; });
    truth.push({ file, style, setup, seed, theme: opt.theme || null, width: img.width, height: img.height, hexes });
    console.log(`${file}: ${img.width}x${img.height}, ${(png.length / 1024).toFixed(0)} KB`);
  }
  await browser.close();
  const note = 'Written by scripts/make-board-fixtures.cjs. x and y: the exact pixel position of each tile centre (where its number token sits), after every transform; the first pixel centre is (0.5, 0.5).';
  writeFileSync(path.join(OUT, 'truth.json'), `{"note": ${JSON.stringify(note)},\n"images": [\n${truth.map(t => JSON.stringify(t)).join(',\n')}\n]}\n`);
  console.log(`${truth.length} images, ${(bytes / 1024).toFixed(0)} KB of PNG`);
})().catch(e => { console.error(e); process.exit(1); });

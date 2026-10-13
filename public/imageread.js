// Read a board from a picture: a screenshot or a top-down photo of a Catan board, plus four taps on the number
// tokens of the corner tiles, gives a best guess for every tile's resource and number, so the user only fixes
// the mistakes in the board editor. Pure functions with no DOM and no dependencies, so the same file runs in the
// browser (on canvas getImageData output) and under node --test. Nothing is random: same input, same output.
//
// Steps: (1) the taps give a perspective map (homography) from board coordinates to picture pixels; (2) each
// tile's number token is found near where the map puts it (a light disc with a round edge), and the tokens found
// refine the map, starting near the taps and working outwards; (3) tile colours are sampled in a ring between
// the token and the tile's edge and given resources with the box's tile counts as a hard rule (an optimal
// assignment), starting from known board palettes and then re-estimating each colour from the picture itself;
// (4) each token is turned upright by its row of pips (tokens lie at any angle on a table) and read from its marks:
// the pips (dots), how many digits, holes inside the digits, and red ink.
//
// Picture coordinates are pixels from the top-left corner, as a tap on a canvas gives them: the first pixel
// covers 0 to 1, so its centre is (0.5, 0.5). Notes count tiles from 1 (like the board editor's "Hex 1"),
// while `uncertain` holds hex ids (from 0).
import { buildGraph } from './geometry.js';
import { SETUPS, PIPS } from './board.js';

const CLASSES = ['wood', 'brick', 'wheat', 'sheep', 'ore', 'desert'];
const NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'];

// Starting palettes only: every picture's own colours are re-estimated after the first pass. Catan Lens is exact
// (public/style.css); the online and printed palettes are typical colours, not measured from any product.
const PALETTES = {
  'catan-lens': { wood: '#7f9c6f', brick: '#c9896a', wheat: '#e4c96f', sheep: '#bdd7a3', ore: '#a6aab0', desert: '#e9dfc6' },
  online: { wood: '#3f7a35', brick: '#bf5a2e', wheat: '#efc13e', sheep: '#9bcf5a', ore: '#8f97a3', desert: '#e3cd92' },
  printed: { wood: '#3d5f2c', brick: '#ac5532', wheat: '#d9b23f', sheep: '#93bd52', ore: '#878c92', desert: '#d2b880' },
};

// ---- public API ---------------------------------------------------------------------------------------------

// The four tiles whose number tokens the user taps, in tap order, with their board coordinates.
export function referenceTiles(setup) {
  // An own key only: names every object has (constructor, toString, __proto__) are not layouts.
  if (!Object.prototype.hasOwnProperty.call(SETUPS, setup)) throw new Error(`Unknown board layout "${setup}": use "base" (19 tiles) or "ext56" (30 tiles).`);
  const { hexes, rows } = buildGraph(SETUPS[setup].layout);
  const ids = [0, rows[0] - 1, hexes.length - 1, hexes.length - rows[rows.length - 1]];
  return ids.map((id, i) => ({ id, corner: CORNERS[i], x: hexes[id].x, y: hexes[id].y }));
}

// Perspective map (3x3, row major, last entry 1) taking each `from` point to its `to` point. Four pairs give an
// exact map; more pairs give the least-squares fit. Throws on repeated points or three points in a line.
export function homography(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to) || from.length < 4 || from.length !== to.length) throw new Error('A perspective map needs at least four matching pairs of points.');
  if ([...from, ...to].some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Every point needs a finite x and y.');
  if (degenerate(from) || degenerate(to)) throw new Error('The points are too close together or in a line, so they do not fix a perspective map.');
  const nf = normaliser(from), nt = normaliser(to);
  const M = Array.from({ length: 8 }, () => new Float64Array(8)), v = new Float64Array(8);
  for (let i = 0; i < from.length; i++) {
    const x = (from[i].x - nf.cx) * nf.s, y = (from[i].y - nf.cy) * nf.s, u = (to[i].x - nt.cx) * nt.s, w = (to[i].y - nt.cy) * nt.s;
    for (const [row, rhs] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -w * x, -w * y], w]]) {
      for (let a = 0; a < 8; a++) { v[a] += row[a] * rhs; for (let b = 0; b < 8; b++) M[a][b] += row[a] * row[b]; }
    }
  }
  const h = solve(M, v);
  if (!h) throw new Error('The points do not fix a perspective map.');
  // Undo the normalisation: H = inverse(Tto) * Hn * Tfrom.
  const Tf = [nf.s, 0, -nf.s * nf.cx, 0, nf.s, -nf.s * nf.cy, 0, 0, 1], Ti = [1 / nt.s, 0, nt.cx, 0, 1 / nt.s, nt.cy, 0, 0, 1];
  const H = mul3(Ti, mul3([...h, 1], Tf));
  return H.map(x => x / H[8]);
}

export function project(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

// Minimum-cost assignment (Hungarian method) on a square cost matrix: returns the column for each row.
export function assign(cost) {
  const n = cost.length, u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity), used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(n);
  for (let j = 1; j <= n; j++) out[p[j] - 1] = j - 1;
  return out;
}

// image: { width, height, data } as from canvas getImageData (RGBA bytes; alpha is ignored); pass the full-size
// picture, since only the tiles are sampled. taps: four picture points at the centres of the reference tiles' number
// tokens, in referenceTiles() order. Returns { hexes, uncertain, notes }: hexes in hex id order, each { resource,
// number, resourceConfidence, numberConfidence } (confidences 0 to 1), ready for boardFrom(); uncertain lists the hex
// ids worth a check; notes are plain-English sentences for the user. Throws an Error with a plain-English message
// when the picture or the taps cannot be used.
export function readBoard(image, setup, taps) {
  const refs = referenceTiles(setup);
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || !image.data || image.data.length !== image.width * image.height * 4) throw new Error('The picture could not be read: it needs a width, a height and four bytes (red, green, blue, alpha) per pixel.');
  if (image.width < 64 || image.height < 64) throw new Error(`The picture is too small (${image.width} by ${image.height} pixels): it needs to be at least 64 pixels each way.`);
  if (!Array.isArray(taps) || taps.length !== 4 || taps.some(t => !t || !Number.isFinite(t.x) || !Number.isFinite(t.y))) throw new Error('Tap the number tokens of the four corner tiles: top left, top right, bottom right, bottom left.');
  if (taps.some(t => t.x < 0 || t.y < 0 || t.x > image.width || t.y > image.height)) throw new Error('Every tap must be inside the picture.');
  if (degenerate(taps)) throw new Error('The four taps are too close together or in a line. Tap the number tokens of the four corner tiles.');
  if (!clockwiseConvex(taps)) throw new Error('The four taps must go around the board in order: top left, top right, bottom right, bottom left.');
  const H = homography(refs, taps), graph = buildGraph(SETUPS[setup].layout), spacing = Math.sqrt(3) * scaleAt(H, refs[0].x, refs[0].y);
  if (spacing < 24) throw new Error(`The board is too small in this picture (about ${Math.round(spacing)} pixels between tokens). Use a closer or larger picture.`);

  const { H: map, found } = locateTokens(image, graph, H, refs);
  const present = presence(found);
  const deserts = SETUPS[setup].tiles.desert, expected = graph.hexes.length - deserts;
  if (present.filter(p => p >= 0.5).length < 0.6 * expected) throw new Error(`I could not find the number tokens where a ${graph.hexes.length}-tile board would have them. Check that the board size is right (19 or 30 tiles), then tap the number tokens on the four corner tiles again.`);
  const radius = median(found.filter((_, i) => present[i] >= 0.5).map(f => f.r));
  const inverse = invert3(map);
  const centres = found.map(f => project(inverse, { x: f.ix, y: f.iy }));

  const colours = tileColours(image, map, graph, centres, present, radius);
  const res = classify(colours, present, SETUPS[setup].tiles);
  const marks = graph.hexes.map((h, i) => (present[i] >= 0.5 ? readToken(image, map, centres[i], radius) : null));
  const nums = readNumbers(marks);

  // A desert never has a number; for a desert, numberConfidence says how sure we are that no token is there. A number
  // is only as sure as its token: a faint or odd disc may not be where it was looked for, and trying several turns
  // of such a patch can find a number that fits by chance.
  const hexes = graph.hexes.map((h, i) => {
    const resource = res.resource[i], r = resource === 'desert' ? null : nums[i];
    return { resource, number: r ? r.number : null, resourceConfidence: round2(res.confidence[i]), numberConfidence: round2(resource === 'desert' ? 1 - present[i] : r ? r.confidence * present[i] : 0) };
  });
  return { hexes, ...explain(hexes, res, nums, present, SETUPS[setup]) };
}

// ---- finding the tokens -------------------------------------------------------------------------------------

// Search near the taps first (inside the tapped rectangle the map is most accurate), refit the map to every token
// found, then move outwards; finally one tighter pass with the finished map.
function locateTokens(img, graph, H, refs) {
  const xs = refs.map(r => r.x), ys = refs.map(r => r.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const reach = h => len(Math.max(x0 - h.x, 0, h.x - x1), Math.max(y0 - h.y, 0, h.y - y1));
  const found = [];
  for (const [lo, hi] of [[-1, 0.01], [0.01, 2], [2, Infinity]]) {
    for (const h of graph.hexes) if (reach(h) > lo && reach(h) <= hi) found[h.id] = findToken(img, H, h.x, h.y, 0.32, 0.21, 0.5);
    H = refit(H, graph, found);
  }
  // Every token on a board is the same size, so the last pass only accepts radii near the typical one: a round digit
  // (the 0 of 10) can then never pass for the token's rim.
  const typical = median(found.filter(f => f.score >= 0.5 * median(found.map(g => g.score))).map(f => f.r));
  for (const h of graph.hexes) found[h.id] = findToken(img, H, h.x, h.y, 0.2, 0.85 * typical, 1.15 * typical);
  return { H: refit(H, graph, found), found };
}

function refit(H, graph, found) {
  const got = found.map((f, id) => (f ? { id, f } : null)).filter(Boolean);
  const cut = Math.max(6, 0.5 * median(got.map(g => g.f.score)));
  const pairs = got.filter(g => g.f.score >= cut).map(g => ({ b: graph.hexes[g.id], i: { x: g.f.ix, y: g.f.iy } }));
  if (pairs.length < 6) return H;
  const fit = list => homography(list.map(p => p.b), list.map(p => p.i));
  let F = fit(pairs);
  const res = pairs.map(p => { const q = project(F, p.b); return len(q.x - p.i.x, q.y - p.i.y); });
  const lim = Math.max(1.5, 3 * median(res)), kept = pairs.filter((_, k) => res[k] <= lim);
  if (kept.length >= 6 && kept.length < pairs.length) F = fit(kept);
  return F;
}

const K = 32, TURNS = Array.from({ length: K }, (_, k) => trig((2 * Math.PI * k) / K));
const COS = Float64Array.from(TURNS, t => t[0]), SIN = Float64Array.from(TURNS, t => t[1]);

// The token is the circle (centre within `search` board units of the tile centre, radius rMin to rMax units) whose
// edge shows the strongest colour change all the way round: the score is the change at the weakest quarter of the
// circle, so a label or a pip crossing one side cannot fake an edge.
function findToken(img, H, hx, hy, search, rMin, rMax) {
  const ppu = 32, n = Math.ceil((search + rMax + 0.12) * ppu), p = boardPatch(img, H, hx, hy, ppu, n);
  const buf = new Float64Array(K), S = Math.round(search * ppu), lo = rMin * ppu, hi = rMax * ppu;
  let best = { score: -1, x: n, y: n, r: lo };
  for (let dy = -S; dy <= S; dy += 2) for (let dx = -S; dx <= S; dx += 2) for (let r = lo; r <= hi; r += 1) {
    const s = edgeScore(p, n + dx, n + dy, r, buf, 2);
    if (s > best.score) best = { score: s, x: n + dx, y: n + dy, r };
  }
  const c = best;
  for (let dy = -1.5; dy <= 1.5; dy += 0.5) for (let dx = -1.5; dx <= 1.5; dx += 0.5) for (let dr = -1; dr <= 1; dr += 0.5) {
    const r = clamp(c.r + dr, lo, hi), s = edgeScore(p, c.x + dx, c.y + dy, r, buf, 1);
    if (s > best.score) best = { score: s, x: c.x + dx, y: c.y + dy, r };
  }
  const ring = (f0, f1) => {
    const L = [], A = [], B = [];
    for (let k = 0; k < 3; k++) for (let a = 0; a < K; a++) {
      const rho = best.r * (f0 + ((f1 - f0) * k) / 2), x = best.x + rho * COS[a], y = best.y + rho * SIN[a];
      L.push(at(p.L, p.size, x, y)); A.push(at(p.A, p.size, x, y)); B.push(at(p.B, p.size, x, y));
    }
    return [median(L), median(A), median(B)];
  };
  const bx = hx + (best.x - n) / ppu, by = hy + (best.y - n) / ppu, q = project(H, { x: bx, y: by });
  return { ix: q.x, iy: q.y, r: best.r / ppu, score: best.score, inner: ring(0.45, 0.8) };
}

function edgeScore(p, cx, cy, r, buf, step) {
  let m = 0;
  for (let k = 0; k < K; k += step) {
    const xi = cx + (r - 1.5) * COS[k], yi = cy + (r - 1.5) * SIN[k], xo = cx + (r + 1.5) * COS[k], yo = cy + (r + 1.5) * SIN[k];
    const dl = at(p.L, p.size, xi, yi) - at(p.L, p.size, xo, yo), da = at(p.A, p.size, xi, yi) - at(p.A, p.size, xo, yo), db = at(p.B, p.size, xi, yi) - at(p.B, p.size, xo, yo);
    buf[m++] = Math.sqrt(dl * dl + da * da + db * db);
  }
  const used = buf.subarray(0, m).sort();
  return used[m >> 2];
}

// How sure we are that each tile has a token: its edge score against the board's typical token, and its disc
// colour against the typical disc (a robber or a dark piece has a round edge but the wrong colour).
function presence(found) {
  const ref = median(found.map(f => f.score));
  const disc = [0, 1, 2].map(c => median(found.filter(f => f.score >= 0.6 * ref).map(f => f.inner[c])));
  return found.map(f => clamp((f.score / ref - 0.25) / 0.3, 0, 1) * clamp((35 - dist(f.inner, disc)) / 15, 0, 1));
}

// ---- tile colours -------------------------------------------------------------------------------------------

// Median colour of a ring between the token and the tile's edge, corrected for uneven light: the token discs are
// all the same card, so a smooth fit of their colour across the board measures the light falling on each tile.
function tileColours(img, H, graph, centres, present, radius) {
  const r0 = Math.min(0.6, Math.max(0.42, radius + 0.1)), cols = graph.hexes.map(h => ringColour(img, H, h.x, h.y, r0, 0.72));
  const pts = [];
  graph.hexes.forEach((h, i) => { if (present[i] >= 0.5) pts.push({ x: h.x, y: h.y, c: ringColour(img, H, centres[i].x, centres[i].y, 0.5 * radius, 0.8 * radius) }); });
  if (pts.length < 8) return cols;
  const field = lightField(pts), typical = [0, 1, 2].map(c => median(pts.map(p => p.c[c])));
  return graph.hexes.map((h, i) => { const f = field(h.x, h.y); return cols[i].map((v, c) => v * clamp(typical[c] / f[c], 0.5, 2)); });
}

// 36 directions on each of four radii, each radius turned a quarter step so the samples interleave.
const RING = Array.from({ length: 4 }, (_, k) => Array.from({ length: 36 }, (_, a) => trig(((a + k / 4) * Math.PI) / 18)));

function ringColour(img, H, cx, cy, r0, r1) {
  const R = [], G = [], B = [], rgb = [0, 0, 0];
  RING.forEach((turns, k) => {
    const rho = r0 + ((r1 - r0) * k) / 3;
    for (const [c, s] of turns) {
      const q = project(H, { x: cx + rho * c, y: cy + rho * s });
      rgbAt(img, q.x, q.y, rgb);
      R.push(lin(rgb[0])); G.push(lin(rgb[1])); B.push(lin(rgb[2]));
    }
  });
  return [median(R), median(G), median(B)];
}

// Least-squares quadratic surface per colour channel over the board, refitted once without the worst 15%.
function lightField(pts) {
  const cx = median(pts.map(p => p.x)), cy = median(pts.map(p => p.y)), s = Math.max(...pts.map(p => len(p.x - cx, p.y - cy))) || 1;
  const basis = (x, y) => { const u = (x - cx) / s, v = (y - cy) / s; return pts.length >= 14 ? [1, u, v, u * u, u * v, v * v] : [1, u, v]; };
  const fit = (list, c) => {
    const m = basis(0, 0).length, M = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
    for (const p of list) { const f = basis(p.x, p.y); for (let a = 0; a < m; a++) { b[a] += f[a] * p.c[c]; for (let d = 0; d < m; d++) M[a][d] += f[a] * f[d]; } }
    return solve(M, b);
  };
  const coef = [0, 1, 2].map(c => {
    const first = fit(pts, c);
    if (!first) return null;
    const res = pts.map(p => Math.abs(dot(basis(p.x, p.y), first) - p.c[c])), lim = quantile(res, 0.85);
    return fit(pts.filter((_, k) => res[k] <= lim), c) || first;
  });
  return (x, y) => coef.map((q, c) => (q ? Math.max(1e-4, dot(basis(x, y), q)) : 1));
}

// Resources with the box's tile counts as a hard rule. For each known palette: assign, fit one gain per colour
// channel (overall light and colour cast), reassign; keep the palette that fits best. Then re-estimate each
// resource's colour from the tiles given it (pulled towards the palette) and reassign twice more.
function classify(colours, present, tiles) {
  const slots = CLASSES.flatMap(k => Array(tiles[k]).fill(k)), n = colours.length;
  const F = colours.map(c => labFromLinear(...c));
  const tokenCost = (i, k) => 25 * (k === 'desert' ? present[i] : 1 - present[i]);   // a token rules out desert, and its absence suggests it
  const matrix = mu => F.map((f, i) => slots.map(k => dist(f, mu[k]) + tokenCost(i, k)));
  let best = null;
  for (const hexes of Object.values(PALETTES)) {
    const P = Object.fromEntries(CLASSES.map(k => [k, hexLinear(hexes[k])]));
    let gain = [1, 1, 1], pick;
    for (let round = 0; round < 3; round++) {
      const mu = Object.fromEntries(CLASSES.map(k => [k, labFromLinear(...P[k].map((v, c) => v * gain[c]))]));
      pick = assign(matrix(mu)).map(s => slots[s]);
      // Overall brightness may change a lot (0.4 to 2.5 times); a colour cast only a little (0.8 to 1.25 times per
      // channel), so no cast can turn grey into blue.
      const ratio = [0, 1, 2].map(c => median(colours.map((col, i) => Math.max(1e-4, col[c]) / P[pick[i]][c])));
      const bright = cbrt(ratio[0] * ratio[1] * ratio[2]);
      gain = ratio.map(r => clamp(bright, 0.4, 2.5) * clamp(r / bright, 0.8, 1.25));
    }
    const ref = Object.fromEntries(CLASSES.map(k => [k, labFromLinear(...P[k].map((v, c) => v * gain[c]))]));
    const C = matrix(ref), cols = assign(C), total = cols.reduce((s, col, i) => s + C[i][col], 0);
    if (!best || total < best.total) best = { ref, total };
  }
  let mu = best.ref, C, cols;
  for (let round = 0; round < 3; round++) {
    C = matrix(mu); cols = assign(C);
    if (round === 2) break;
    mu = Object.fromEntries(CLASSES.map(k => {
      const mine = F.filter((_, i) => slots[cols[i]] === k);
      return [k, [0, 1, 2].map(c => (mine.reduce((s, f) => s + f[c], 0) + best.ref[k][c]) / (mine.length + 1))];
    }));
  }
  const total = cols.reduce((s, col, i) => s + C[i][col], 0);
  const resource = cols.map(s => slots[s]), confidence = [], alternative = [], familiar = [];
  for (let i = 0; i < n; i++) {
    // Margin: how much worse the best assignment is when this tile must take a different resource.
    const forced = C.map((row, r) => (r === i ? row.map((v, s) => (slots[s] === resource[i] ? v + 1e6 : v)) : row));
    const alt = assign(forced), extra = alt.reduce((s, col, r) => s + C[r][col], 0) - total;
    // Familiarity: how close the tile is to its resource's colour in the chosen palette (after the light fit).
    const off = dist(F[i], best.ref[resource[i]]);
    const beyond = Math.max(0, off - 18);
    familiar.push(expNeg(-(beyond * beyond) / 128));
    confidence.push((1 - expNeg(-extra / 5)) * familiar[i]);
    alternative.push(slots[alt[i]]);
  }
  return { resource, confidence, alternative, familiar };
}

// ---- reading the tokens -------------------------------------------------------------------------------------

const RC = 26;   // token radius in the reading patch, in pixels

// A token can lie at any turn on the table, and a picture of a turned board turns every token with it. The pips sit
// in a row below the digits, so each row of pips found says which way is down: the token is measured again with its
// patch turned to match, and readNumbers keeps the turn that reads best. With no row found (a token without pips,
// or pips too faint) the token is measured as it lies. Returns the marks at each turn, or null when there is no ink.
function readToken(img, H, centre, r) {
  const p = boardPatch(img, H, centre.x, centre.y, RC / r, RC), ink = inkOf(p);
  if (!ink) return null;
  const sharp = r * scaleAt(H, centre.x, centre.y), turns = rowTurns(components(ink.mask, p.size).filter(c => c.area >= Math.max(2, 0.003 * RC * RC)));
  const marks = (turns.length ? turns : [UPRIGHT]).map(t => measureToken(t === UPRIGHT ? p : boardPatch(img, H, centre.x, centre.y, RC / r, RC, t), sharp));
  return marks.some(Boolean) ? marks.filter(Boolean) : null;
}

// Each row of pips found gives a turn to try, the biggest row first (at most four). Candidates are thin pieces of
// ink away from the centre: a pip, or pips blurred into a bar. On the test boards pips are about 0.1 to 0.24 of the
// token radius thick and 0.6 to 0.85 of it from the centre; the limits leave room for a token found a little off
// centre. Pieces closer than a pip gap are one row. The row's side of the centre is down, made exact by the row's
// own line once it is longer than it is thick. A turn is [cos, sin] of the angle, clockwise on the board, that the
// token is turned by.
const AWAY = 0.38 * RC, UPRIGHT = [1, 0];
function rowTurns(comps) {
  const cand = comps.map(c => ({ ...c, ...spread(c) })).filter(c => c.thick <= 0.27 * RC && c.long <= 1.4 * RC && c.area <= 0.3 * RC * RC && len(c.cx - RC, c.cy - RC) >= AWAY);
  const row = cand.map((_, k) => k), root = k => (row[k] === k ? k : (row[k] = root(row[k])));
  cand.forEach((a, k) => cand.slice(0, k).forEach((b, m) => { if (len(a.cx - b.cx, a.cy - b.cy) - (a.long + b.long) / 2 < 0.2 * RC) row[root(m)] = root(k); }));
  const rows = [];
  cand.forEach((c, k) => {
    const g = rows.find(x => x.id === root(k));
    if (!g) rows.push({ id: root(k), area: c.area, sx: c.sx, sy: c.sy, sxx: c.sxx, syy: c.syy, sxy: c.sxy });
    else for (const key of ['area', 'sx', 'sy', 'sxx', 'syy', 'sxy']) g[key] += c[key];
  });
  return rows.map(g => ({ area: g.area, ...spread(g) })).filter(g => len(g.cx - RC, g.cy - RC) >= AWAY).sort((a, b) => b.area - a.area).slice(0, 4).map(g => {
    const { l1, l2, ex, ey, long } = g, x = g.cx - RC, y = g.cy - RC, d = len(x, y);
    // Down is the row's direction from the centre, or the normal to the row's line: each is trusted in proportion to
    // the square of its baseline (the row's distance from the centre, the row's length).
    const w = l1 > 2.5 * Math.max(l2, 0.5) ? (long * long) / (long * long + d * d) : 0, side = -ey * x + ex * y < 0 ? -1 : 1;
    const dx = (1 - w) * (x / d) - w * side * ey, dy = (1 - w) * (y / d) + w * side * ex, e = len(dx, dy);
    // Turned clockwise by angle a, down (0, 1) becomes (-sin a, cos a). Within about 3 degrees of upright (all a
    // screenshot can be, and about what the row tells) the token is read as it lies.
    return Math.abs(dx / e) <= 0.05 && dy > 0 ? UPRIGHT : [dy / e, -dx / e];
  });
}

// Centroid and spread of a piece of ink from its moments: the variances along its long and short axes (l1, l2), the
// long axis (ex, ey), and its length and thickness in pixels (a bar's length, a dot's diameter).
function spread(c) {
  const cx = c.sx / c.area, cy = c.sy / c.area, xx = c.sxx / c.area - cx * cx, yy = c.syy / c.area - cy * cy, xy = c.sxy / c.area - cx * cy;
  const half = (xx + yy) / 2, d = Math.sqrt(Math.max(0, half * half - xx * yy + xy * xy)), l1 = half + d, l2 = Math.max(0, half - d);
  const a = [xy, l1 - xx], b = [l1 - yy, xy], [ax, ay] = len(a[0], a[1]) >= len(b[0], b[1]) ? a : b, e = len(ax, ay);
  return { cx, cy, l1, l2, ex: e ? ax / e : 1, ey: e ? ay / e : 0, long: Math.sqrt(12 * l1), thick: 4 * Math.sqrt(l2) };
}

// Ink is anything clearly darker than the disc; red ink is ink well redder than the disc.
function inkOf(p) {
  const n = RC, size = p.size, N = size * size;
  const inside = new Uint8Array(N), lim = 0.88 * 0.88 * RC * RC, rim = 0.55 * 0.55 * RC * RC, bgL = [], bgA = [];
  for (let j = 0, k = 0; j < size; j++) for (let i = 0; i < size; i++, k++) {
    const d2 = (i - n) * (i - n) + (j - n) * (j - n);
    if (d2 <= lim) { inside[k] = 1; if (d2 >= rim) { bgL.push(p.L[k]); bgA.push(p.A[k]); } }
  }
  const L0 = median(bgL), A0 = median(bgA), dark = [];
  for (let k = 0; k < N; k++) if (inside[k]) dark.push(L0 - p.L[k]);
  const core = quantile(dark, 0.96);
  if (!(core >= 10)) return null;
  const T = Math.max(6, 0.45 * core), mask = new Uint8Array(N), red = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (inside[k] && L0 - p.L[k] > T) { mask[k] = 1; if (p.A[k] - A0 > 12) red[k] = 1; }
  return { inside, core, mask, red };
}

// Marks on one token, upright in its patch (sharp: the token's radius in picture pixels).
function measureToken(p, sharp) {
  const got = inkOf(p);
  if (!got) return null;
  const { inside, core, mask: ink, red } = got, n = RC, size = p.size;
  const comps = components(ink, size, ink, red).filter(c => c.area >= Math.max(2, 0.003 * RC * RC));
  const tall = comps.filter(c => c.y1 - c.y0 + 1 >= 0.3 * RC);
  if (!tall.length) return null;
  const top = Math.min(...tall.map(c => c.y0)), bottom = Math.max(...tall.map(c => c.y1));
  const pips = comps.filter(c => c.y0 > bottom - 1 && Math.abs(c.cx - n) < 0.7 * RC && c.y1 - c.y0 + 1 <= 0.3 * RC);
  const parts = comps.filter(c => !pips.includes(c) && c.cy >= top - 1 && c.cy <= bottom + 1).sort((a, b) => a.x0 - b.x0);
  const block = { x0: Math.min(...parts.map(c => c.x0)), x1: Math.max(...parts.map(c => c.x1)), y0: top, y1: bottom };
  const holes = findHoles(p.L, inside, size, core, block);
  // Pieces of ink that overlap side by side are one digit, and so are the two pieces on either side of a hole that
  // neither contains (blur can thin the top and bottom of a 0 until it splits into two curves).
  const group = parts.map((_, k) => k), root = k => (group[k] === k ? k : (group[k] = root(group[k])));
  parts.forEach((c, k) => { if (k && c.x0 <= Math.max(...parts.slice(0, k).map(d => d.x1))) group[root(k)] = root(k - 1); });
  for (const h of holes) {
    if (parts.some(c => c.x0 <= h.x0 && c.x1 >= h.x1)) continue;
    const beside = side => parts.map((c, k) => ({ c, k })).filter(({ c }) => c.y0 <= h.y1 && c.y1 >= h.y0 && (side < 0 ? c.x1 <= h.x0 : c.x0 >= h.x1))
      .sort((a, b) => (side < 0 ? b.c.x1 - a.c.x1 : a.c.x0 - b.c.x0))[0];
    const l = beside(-1), r = beside(1);
    if (l && r) group[root(r.k)] = root(l.k);
  }
  const glyphs = [];
  parts.forEach((c, k) => {
    const g = glyphs.find(x => x.id === root(k));
    if (g) { g.x0 = Math.min(g.x0, c.x0); g.x1 = Math.max(g.x1, c.x1); g.y0 = Math.min(g.y0, c.y0); g.y1 = Math.max(g.y1, c.y1); g.area += c.area; g.red += c.red; }
    else glyphs.push({ id: root(k), x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, area: c.area, red: c.red });
  });
  const real = glyphs.filter(g => g.area >= 0.025 * RC * RC);
  let count = real.length;
  if (count === 1) {   // two digits printed close together can touch: look for a clear gap in the ink columns
    const g = real[0], w = g.x1 - g.x0 + 1, cols = new Float64Array(w);
    for (let j = g.y0; j <= g.y1; j++) for (let i = g.x0; i <= g.x1; i++) cols[i - g.x0] += ink[j * size + i];
    const peak = Math.max(...cols), mid = cols.subarray(Math.floor(w * 0.3), Math.ceil(w * 0.7));
    if (w >= 0.85 * (g.y1 - g.y0 + 1) && mid.length && Math.min(...mid) <= 0.12 * peak) count = 2;
  }
  const inkArea = real.reduce((s, g) => s + g.area, 0) + pips.reduce((s, c) => s + c.area, 0);
  const redArea = real.reduce((s, g) => s + g.red, 0) + pips.reduce((s, c) => s + c.red, 0);
  const singles = pips.filter(c => c.x1 - c.x0 + 1 <= 1.7 * (c.y1 - c.y0 + 1)).sort((a, b) => a.cx - b.cx);
  const gaps = singles.slice(1).map((c, k) => (c.cx - singles[k].cx) / RC).filter(g => g < 0.6);
  return {
    glyphs: Math.min(2, count), holes, red: inkArea ? redArea / inkArea : 0, gaps,
    pips: pips.map(c => ({ w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1 })), sharp,
  };
}

// Holes are light pockets the ink closes off. Flooding inwards from the disc's edge, each pixel can be reached no
// lighter than the darkest step on its best path; a pocket much lighter than that is enclosed. This survives blur
// that would close a hole for a plain threshold. Each hole inside the digits' box reports its depth as a share of the
// ink's darkness and its height as a share of the digits' height (0 at the top).
function findHoles(L, inside, size, core, box) {
  const N = size * size, reach = new Float32Array(N).fill(-Infinity), seen = new Uint8Array(N), heap = new Heap(N);
  for (let k = 0; k < N; k++) if (inside[k] && (!inside[k - 1] || !inside[k + 1] || !inside[k - size] || !inside[k + size])) { reach[k] = L[k]; seen[k] = 1; heap.push(k, L[k]); }
  while (heap.size) {
    const k = heap.pop();
    for (const q of [k - 1, k + 1, k - size, k + size]) if (inside[q] && !seen[q]) { seen[q] = 1; reach[q] = Math.min(reach[k], L[q]); heap.push(q, reach[q]); }
  }
  const pocket = new Uint8Array(N), depth = new Float32Array(N);
  for (let k = 0; k < N; k++) if (inside[k]) { depth[k] = (L[k] - reach[k]) / core; if (depth[k] > 0.12) pocket[k] = 1; }
  const out = [];
  for (const c of components(pocket, size)) {
    if (c.area < 2 || c.x0 < box.x0 - 1 || c.x1 > box.x1 + 1 || c.y0 < box.y0 - 1 || c.y1 > box.y1 + 1) continue;
    let deepest = 0;
    for (let j = c.y0; j <= c.y1; j++) for (let i = c.x0; i <= c.x1; i++) if (pocket[j * size + i]) deepest = Math.max(deepest, depth[j * size + i]);
    out.push({ depth: deepest, at: (c.cy - box.y0) / (box.y1 - box.y0 + 1), x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 });
  }
  return out;
}

// Where each number's holes sit, as a share of the digit's height from its top: 9's bowl is high, 4's triangle and
// the 0 of 10 are in the middle, 6's bowl is low and 8 has both. Measured alike in serif and sans-serif fonts.
const HOLES = { 2: [], 3: [], 4: [0.48], 5: [], 6: [0.65], 8: [0.25, 0.67], 9: [0.3], 10: [0.48], 11: [], 12: [] };

// Soft hole evidence: each expected hole is matched by the strongest found hole near its height; found holes the
// number should not have count against it. Depth is judged against `clarity`, how deep clear holes are in this
// picture, so a shallow hole counts partly. Blur can fill a hole in, so a missing one costs only `trust` (0.3 to 1).
// 4 may also be drawn open.
function holeCost(v, holes, clarity, trust) {
  const fit = slots => {
    const left = holes.map(h => clamp((h.depth / clarity - 0.2) / 0.5, 0, 1));
    let cost = 0;
    for (const at of slots) {
      let best = 0, k = -1;
      holes.forEach((h, j) => { const q = left[j] * clamp(1 - (Math.abs(h.at - at) - 0.05) / 0.15, 0, 1); if (q > best) { best = q; k = j; } });
      cost += (1 - best) * trust;
      if (k >= 0) left[k] -= best;
    }
    return cost + left.reduce((s, x) => s + x, 0);
  };
  return v === 4 ? Math.min(fit(HOLES[4]), fit([]) + 0.3) : fit(HOLES[v]);
}

// Pip spacing in reading-patch pixels, learnt from this picture: the gaps between pips that stand apart, or else
// the step that makes every blurred row's length beyond its first pip a whole number of steps (1 to 4).
function pipSpacing(marks) {
  const gaps = marks.flatMap(m => (m ? m.gaps : []));
  if (gaps.length >= 3) return median(gaps) * RC;
  const rows = marks.flatMap(m => (m ? m.pips.filter(c => c.w > 1.7 * c.h).map(c => c.w - c.h) : []));
  const heights = marks.flatMap(m => (m ? m.pips.map(c => c.h) : []));
  if (rows.length < 3) return 1.35 * (median(heights) || 0.17 * RC);
  let best = null;
  for (let s = 0.12 * RC; s <= 0.45 * RC; s += 0.005 * RC) {
    const err = rows.reduce((e, x) => { const d = x - clamp(Math.round(x / s), 1, 4) * s; return e + d * d; }, 0);
    if (!best || err < best.err - 1e-9) best = { s, err };
  }
  return best.s;
}

// Combine the cues: pips pick the pair {2,12} {3,11} {4,10} {5,9} {6,8}; digit count, holes and red split it. Each
// token comes measured at one or more turns (readToken) and the turn whose best number costs least wins. The
// picture's pip spacing and hole depth are learnt from each token's likeliest turn (its biggest row of pips), then
// again from the winning turns.
function readNumbers(tokens) {
  let chosen = tokens.map(t => t && t[0]), out;
  for (let pass = 0; pass < 2; pass++) {
    const spacing = pipSpacing(chosen), read = chosen.filter(Boolean);
    // How deep clear holes are in this picture: the deepest hole of each token that has one (most boards have
    // eight or more: every 4, 6, 8, 9 and 10). Sharp renders give about 0.9, blurred photos 0.3 to 0.5.
    const deepest = read.map(m => Math.max(0, ...m.holes.map(h => h.depth))).filter(d => d >= 0.15);
    const clarity = deepest.length >= 3 ? median(deepest) : 0.5, sharp = median(read.map(m => m.sharp));
    const score = m => {
      const pips = m.pips.reduce((s, c) => s + (c.w <= 1.7 * c.h ? 1 : 1 + (c.w - c.h) / spacing), 0);
      const red = clamp((m.red - 0.1) / 0.3, 0, 1);
      // Trust a missing hole less in a blurry picture, on tokens smaller than the board's typical one (far away), and
      // on tokens only a few pixels across.
      const trust = clamp((clarity - 0.1) / 0.4, 0.3, 1) * clamp(m.sharp / sharp, 0.6, 1) * clamp((m.sharp - 7) / 6, 0.3, 1);
      const costs = NUMBERS.map(v => ({
        v, c: Math.abs(pips - PIPS[v]) + 2 * Math.abs(m.glyphs - (v > 9 ? 2 : 1)) + 3 * Math.abs(red - (v === 6 || v === 8 ? 1 : 0)) + holeCost(v, m.holes, clarity, trust),
      })).sort((a, b) => a.c - b.c || a.v - b.v);
      return { m, pips, costs };
    };
    out = tokens.map(t => {
      if (!t) return null;
      const { m, pips, costs } = t.map(score).reduce((a, b) => (b.costs[0].c < a.costs[0].c ? b : a));
      // Pips closer than about 3 picture pixels blur into each other, so counts below that are guesses.
      const legible = clamp(((spacing / RC) * m.sharp - 1.6) / 0.8, 0, 1);
      const margin = costs[1].c - costs[0].c, fit = clamp(1 - (costs[0].c - 0.8) / 1.5, 0, 1);
      return { marks: m, number: costs[0].v, alternative: costs[1].v, confidence: clamp(margin / 1.5, 0, 1) * fit * legible, legible, pips };
    });
    chosen = out.map(r => r && r.marks);
  }
  return out;
}

// ---- notes for the user -------------------------------------------------------------------------------------

function explain(hexes, res, nums, present, spec) {
  const uncertain = new Set(), notes = [];
  const unfamiliar = median(res.familiar) < 0.5;
  if (unfamiliar) notes.push('The tile colours in this picture do not match any board style I know, so the tile types are guesses. Please check every tile.');
  if (median(nums.filter(Boolean).map(r => r.legible)) < 0.5) notes.push('The numbers are very small in this picture, so I could not read them reliably. A closer or sharper picture will work better.');
  hexes.forEach((h, i) => {
    const why = [];
    if (h.resourceConfidence < 0.5 && !unfamiliar) why.push(`looks like ${h.resource} or ${res.alternative[i]}`);
    if (h.resource === 'desert' && present[i] >= 0.5) why.push('looks like desert but seems to have a number token');
    else if (h.resource !== 'desert' && present[i] < 0.5) why.push(`looks like ${h.resource}, but I could not find its number token`);
    else if (h.resource !== 'desert' && !h.number) why.push(`looks like ${h.resource}, but I could not read its number`);
    if (h.number && h.numberConfidence < 0.5) why.push(`has a number that looks like ${h.number} or ${nums[i].alternative}`);
    if (why.length || h.resourceConfidence < 0.5) uncertain.add(i);
    if (why.length) notes.push(`Tile ${i + 1} ${why.join(', and ')}; please check it.`);
  });
  const have = {}, want = {};
  for (const t of spec.tokens) want[t] = (want[t] || 0) + 1;
  hexes.forEach((h, i) => { if (h.number) (have[h.number] ||= []).push(i); });
  for (const [v, ids] of Object.entries(have)) if (ids.length > (want[v] || 0)) {
    notes.push(`I read the number ${v} on ${ids.length} tiles, but the box has ${want[v] || 0}. Please check tiles ${list(ids.map(i => i + 1))}.`);
    ids.slice().sort((a, b) => hexes[a].numberConfidence - hexes[b].numberConfidence).slice(0, ids.length - (want[v] || 0)).forEach(i => uncertain.add(i));
  }
  return { uncertain: [...uncertain].sort((a, b) => a - b), notes };
}

const list = xs => (xs.length < 2 ? String(xs[0]) : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const round2 = x => Math.round(clamp(x, 0, 1) * 100) / 100;

// ---- small helpers ------------------------------------------------------------------------------------------

// Every corner turns the same way (clockwise on screen, where y points down), so the taps go round in order.
function clockwiseConvex(q) {
  return q.every((a, i) => {
    const b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;
  });
}

function degenerate(pts) {
  const span = Math.max(...pts.flatMap(a => pts.map(b => len(a.x - b.x, a.y - b.y))));
  if (!(span > 0)) return true;
  if (pts.length === 4) {
    for (let i = 0; i < 4; i++) {
      const [a, b, c] = pts.filter((_, k) => k !== i);
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-3 * span * span) return true;
    }
    return false;
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - cx) * (p.x - cx); syy += (p.y - cy) * (p.y - cy); sxy += (p.x - cx) * (p.y - cy); }
  return sxx * syy - sxy * sxy < 1e-6 * (sxx + syy) * (sxx + syy);
}

function normaliser(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const mean = pts.reduce((s, p) => s + len(p.x - cx, p.y - cy), 0) / pts.length;
  return { cx, cy, s: Math.SQRT2 / mean };
}

// Gaussian elimination with partial pivoting; null when the system is singular.
function solve(M, v) {
  const n = v.length, A = M.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (!(Math.abs(A[p][c]) > 1e-10)) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = A[r][n]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

function mul3(a, b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(x => x / det);
}

// Picture pixels per board unit around a board point.
function scaleAt(H, x, y) {
  const p = project(H, { x, y }), a = project(H, { x: x + 0.01, y }), b = project(H, { x, y: y + 0.01 });
  return Math.sqrt(Math.abs((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x))) / 0.01;
}

// Same bits in every JavaScript engine: this file uses only + - * / and square root (correctly rounded everywhere).
// Math.pow, exp, log, cbrt, sin, cos and hypot may differ in the last digit between engines (Node 22 and Chromium
// 148 do for pow, exp, log, sin and cos), which can flip a near tie, so the few needed are built from arithmetic.
const len = (x, y) => Math.sqrt(x * x + y * y);

// Cube root: scale by powers of 8 into 1/8 to 1 (exact), then Newton's method from a close start.
function cbrt(t) {
  if (!(t > 0)) return 0;
  let s = 1;
  while (t < 0.125) { t *= 8; s /= 2; }
  while (t >= 1) { t /= 8; s *= 2; }
  let y = 0.5 + 0.5 * t;
  for (let i = 0; i < 6; i++) y = (2 * y + t / (y * y)) / 3;
  return y * s;
}

// e to the power x, for x at most 0: halve x until it is small (exact), sum the series, then square back up.
function expNeg(x) {
  let n = 0, sum = 1, term = 1;
  while (x < -0.5) { x /= 2; n++; }
  for (let k = 1; k < 14; k++) { term *= x / k; sum += term; }
  while (n-- > 0) sum *= sum;
  return sum;
}

// Cosine and sine of an angle in radians, by their series after reducing the angle to -pi to pi.
function trig(a) {
  const t = a - 2 * Math.PI * Math.round(a / (2 * Math.PI)), t2 = t * t;
  let c = 1, s = t, tc = 1, ts = t;
  for (let n = 1; n < 15; n++) { tc *= -t2 / ((2 * n - 1) * (2 * n)); ts *= -t2 / (2 * n * (2 * n + 1)); c += tc; s += ts; }
  return [c, s];
}

// sRGB byte to linear light. Its 2.4 power is x squared times the fifth root of x squared (Newton's method).
const LIN = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  if (c <= 0.04045) return c / 12.92;
  const x = (c + 0.055) / 1.055, a = x * x;
  let y = 1;
  for (let k = 0; k < 30; k++) y = (4 * y + a / (y * y * y * y)) / 5;
  return a * y;
});
const lin = v => LIN[v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0];
const hexLinear = hex => hex.match(/\w\w/g).map(x => LIN[parseInt(x, 16)]);

// CIELAB (D65) from linear RGB.
function labFromLinear(r, g, b) {
  const f = t => (t > 216 / 24389 ? cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b), fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Colour difference with lightness at half weight: shade and uneven light move lightness far more than hue.
const dist = (p, q) => { const l = 0.5 * (p[0] - q[0]), a = p[1] - q[1], b = p[2] - q[2]; return Math.sqrt(l * l + a * a + b * b); };

// Bilinear colour at picture point (x, y).
function rgbAt(img, x, y, out) {
  const w = img.width, h = img.height, d = img.data;
  const fx = clamp(x - 0.5, 0, w - 1), fy = clamp(y - 0.5, 0, h - 1), x0 = Math.min(w - 2, fx | 0), y0 = Math.min(h - 2, fy | 0);
  const tx = fx - x0, ty = fy - y0, i = (y0 * w + x0) * 4, j = i + w * 4;
  for (let c = 0; c < 3; c++) out[c] = (d[i + c] * (1 - tx) + d[i + 4 + c] * tx) * (1 - ty) + (d[j + c] * (1 - tx) + d[j + 4 + c] * tx) * ty;
}

// A square patch of the picture laid out in board coordinates (ppu pixels per board unit, centre pixel at the
// board point), as CIELAB planes. Each patch pixel averages several picture samples when the picture is sharper.
// `turn` ([cos, sin] of an angle, clockwise on the board) turns the patch with it: what is drawn turned by that
// angle comes out upright.
function boardPatch(img, H, cx, cy, ppu, n, turn = [1, 0]) {
  const size = 2 * n + 1, L = new Float32Array(size * size), A = new Float32Array(size * size), B = new Float32Array(size * size);
  const ss = clamp(Math.round(scaleAt(H, cx, cy) / ppu), 1, 3), rgb = [0, 0, 0], [c, s] = turn;
  for (let j = 0, k = 0; j < size; j++) for (let i = 0; i < size; i++, k++) {
    let r = 0, g = 0, b = 0;
    for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
      const u = (i - n + (si + 0.5) / ss - 0.5) / ppu, v = (j - n + (sj + 0.5) / ss - 0.5) / ppu;
      const bx = cx + c * u - s * v, by = cy + s * u + c * v, w = H[6] * bx + H[7] * by + H[8];
      rgbAt(img, (H[0] * bx + H[1] * by + H[2]) / w, (H[3] * bx + H[4] * by + H[5]) / w, rgb);
      r += lin(rgb[0]); g += lin(rgb[1]); b += lin(rgb[2]);
    }
    const lab = labFromLinear(r / (ss * ss), g / (ss * ss), b / (ss * ss));
    L[k] = lab[0]; A[k] = lab[1]; B[k] = lab[2];
  }
  return { n, size, L, A, B };
}

function at(P, size, x, y) {
  const fx = clamp(x, 0, size - 1), fy = clamp(y, 0, size - 1), x0 = Math.min(size - 2, fx | 0), y0 = Math.min(size - 2, fy | 0), tx = fx - x0, ty = fy - y0, k = y0 * size + x0;
  return (P[k] * (1 - tx) + P[k + 1] * tx) * (1 - ty) + (P[k + size] * (1 - tx) + P[k + size + 1] * tx) * ty;
}

// 4-connected components of a mask: area, bounding box, centroid, sums for the second moments, and how many pixels
// are also in `strong` and `red`.
function components(mask, size, strong, red) {
  const label = new Int32Array(mask.length), out = [], stack = [];
  for (let s = 0; s < mask.length; s++) if (mask[s] && !label[s]) {
    const c = { area: 0, x0: Infinity, x1: -1, y0: Infinity, y1: -1, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, strong: 0, red: 0 };
    label[s] = out.length + 1; stack.push(s);
    while (stack.length) {
      const k = stack.pop(), i = k % size, j = (k / size) | 0;
      c.area++; c.sx += i; c.sy += j; c.sxx += i * i; c.syy += j * j; c.sxy += i * j; if (strong && strong[k]) c.strong++; if (red && red[k]) c.red++;
      if (i < c.x0) c.x0 = i; if (i > c.x1) c.x1 = i; if (j < c.y0) c.y0 = j; if (j > c.y1) c.y1 = j;
      for (const q of [i > 0 ? k - 1 : -1, i < size - 1 ? k + 1 : -1, k - size, k + size]) if (q >= 0 && q < mask.length && mask[q] && !label[q]) { label[q] = out.length + 1; stack.push(q); }
    }
    c.cx = c.sx / c.area; c.cy = c.sy / c.area;
    out.push(c);
  }
  return out;
}

// Max-heap of pixel indices by value, for the hole flood.
class Heap {
  constructor(n) { this.k = new Int32Array(n); this.v = new Float32Array(n); this.size = 0; }
  push(k, v) {
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.v[p] >= v) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = k; this.v[i] = v;
  }
  pop() {
    const top = this.k[0], k = this.k[--this.size], v = this.v[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.v[c + 1] > this.v[c]) c++;
      if (this.v[c] <= v) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = k; this.v[i] = v;
    return top;
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
function median(xs) {
  const a = Float64Array.from(xs).sort(), n = a.length;
  return n ? (n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2) : NaN;
}
function quantile(xs, q) {
  const a = Float64Array.from(xs).sort();
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN;
}

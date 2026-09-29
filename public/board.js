// Random board generation following the official "variable setup": shuffle the land tiles,
// lay the number tokens in a spiral from the outer ring inward (skipping deserts), and deal
// the harbour tokens around the coast. Seeded, so the same seed always gives the same board.
import { buildGraph } from './geometry.js';

export const RESOURCES = ['wood', 'brick', 'wheat', 'sheep', 'ore'];

export const SETUPS = {
  base: {
    layout: 'base',
    tiles: { wood: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 },
    // Official token order A..R (this sequence keeps 6 and 8 apart when laid in a spiral).
    tokens: [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11],
    harbors: ['3:1', '3:1', '3:1', '3:1', 'wood', 'brick', 'wheat', 'sheep', 'ore'],
  },
  ext56: {
    layout: 'ext56',
    tiles: { wood: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 },
    tokens: [2, 5, 4, 6, 3, 9, 8, 11, 11, 10, 6, 3, 8, 4, 8, 10, 11, 12, 10, 5, 4, 9, 5, 9, 12, 3, 2, 6],
    harbors: ['3:1', '3:1', '3:1', '3:1', '3:1', '3:1', 'wood', 'brick', 'wheat', 'sheep', 'ore'],
  },
};

// Number of ways to roll each total with two dice — the "pips" printed on the token.
export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

// Small seeded generator (mulberry32) so boards are reproducible from their seed.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Hexes that share an edge (two common corners).
function hexNeighbors(graph) {
  const out = graph.hexes.map(() => new Set());
  for (const e of graph.edges) if (e.hexes.length === 2) { out[e.hexes[0]].add(e.hexes[1]); out[e.hexes[1]].add(e.hexes[0]); }
  return out.map(s => [...s]);
}

// Spiral order: peel the board layer by layer from the outside in, walking each layer in the
// same rotational direction and starting each inner layer next to where the outer one ended.
// `turn` rotates where the outer ring starts.
function spiralOrder(graph, turn) {
  const nb = hexNeighbors(graph);
  const cx = graph.hexes.reduce((s, h) => s + h.x, 0) / graph.hexes.length;
  const cy = graph.hexes.reduce((s, h) => s + h.y, 0) / graph.hexes.length;
  const layer = graph.hexes.map(h => (nb[h.id].length < 6 ? 0 : Infinity));
  for (let l = 0; layer.some(v => v === Infinity); l++) {
    for (const h of graph.hexes) if (layer[h.id] === Infinity && nb[h.id].some(n => layer[n] === l)) layer[h.id] = l + 1;
  }
  const maxL = Math.max(...layer);
  // Official spiral: walk the outer ring, then step inward next to where you stopped and keep
  // going the same way — every step in the order is to an adjacent hex.
  const order = [];
  let prevEnd = null;
  for (let l = 0; l <= maxL; l++) {
    const ring = graph.hexes.filter(h => layer[h.id] === l)
      .map(h => ({ id: h.id, a: (Math.atan2(h.y - cy, h.x - cx) + Math.PI * 2.5 + (turn * Math.PI) / 3) % (Math.PI * 2) }))
      .sort((p, q) => p.a - q.a);
    let start = 0;
    if (prevEnd !== null) {
      // begin at the ring hex adjacent to the previous ring's last hex, preferring the one furthest along
      // in walking order so the spiral keeps turning instead of doubling back
      const adj = ring.map((r, i) => (nb[prevEnd].includes(r.id) ? i : -1)).filter(i => i >= 0);
      if (adj.length) start = adj.reduce((a, b) => (b > a ? b : a));
    }
    const walk = [...ring.slice(start), ...ring.slice(0, start)];
    order.push(...walk.map(r => r.id));
    prevEnd = walk[walk.length - 1].id;
  }
  return order;
}

export const spiralOrderForTest = spiralOrder;   // test hook only

function redsTouch(graph, numbers) {
  const nb = hexNeighbors(graph);
  return graph.hexes.some(h => (numbers[h.id] === 6 || numbers[h.id] === 8) && nb[h.id].some(n => numbers[n] === 6 || numbers[n] === 8));
}

// Harbour edges: spread the harbours evenly around the coast so no two share a corner.
function harborEdges(graph, count) {
  const per = graph.perimeter;
  const out = [];
  for (let i = 0; i < count; i++) out.push(per[Math.round((i * per.length) / count) % per.length]);
  return out;
}

// `balanced` asks for 6 and 8 never to share an edge. The six spiral rotations almost always
// satisfy it; otherwise tokens are shuffled with rejection (bounded). If even that fails the
// board is returned with `balanced: false` and `balanceFailed: true` — never mislabelled.
// `_spirals` / `_tries` exist only so a test can force the exhaustion path.
export function generateBoard({ setup = 'base', seed = 1, balanced = true, _spirals = 6, _tries = 2000 } = {}) {
  const spec = SETUPS[setup];
  const graph = buildGraph(spec.layout);
  const rand = rng(seed);

  const tiles = shuffle(Object.entries(spec.tiles).flatMap(([r, n]) => Array(n).fill(r)), rand);

  // Numbers: official spiral. Try the six rotations of the spiral; if reds still touch
  // (possible on the stretched 5-6 board), fall back to shuffled tokens with rejection.
  let numbers = null;
  const lay = order => {
    const n = graph.hexes.map(() => null);
    let k = 0;
    for (const id of order) if (tiles[id] !== 'desert') n[id] = spec.tokens[k++];
    return n;
  };
  for (let turn = 0; turn < _spirals && !numbers; turn++) {
    const cand = lay(spiralOrder(graph, turn));
    if (!balanced || !redsTouch(graph, cand)) numbers = cand;
  }
  for (let tries = 0; !numbers && tries < _tries; tries++) {
    const cand = graph.hexes.map(() => null);
    const toks = shuffle(spec.tokens, rand);
    let k = 0;
    for (const h of graph.hexes) if (tiles[h.id] !== 'desert') cand[h.id] = toks[k++];
    if (!redsTouch(graph, cand)) numbers = cand;
  }
  let balanceFailed = false;
  if (!numbers) { numbers = lay(spiralOrder(graph, 0)); balanceFailed = true; }
  const isBalanced = !redsTouch(graph, numbers);   // reported from the board itself, never assumed

  const harbors = {};
  const types = shuffle(spec.harbors, rand);
  harborEdges(graph, types.length).forEach((eid, i) => { harbors[eid] = types[i]; });

  const hexes = graph.hexes.map(h => ({ ...h, resource: tiles[h.id], number: numbers[h.id] }));
  return { setup, seed, balanced: isBalanced, balanceFailed, graph, hexes, harbors };
}

export function randomSeed() { return Math.floor(Math.random() * 0xffffffff) >>> 0; }

// ---- Your board: a board entered by hand (2026-09-15) -------------------------------------
// Same shape as a generated board so every feature (ranking, reasons, second settlement, opponents,
// projected draft, share link) works on the board in front of you. `custom: true`, `seed: null`.
// A hex you have not painted yet is 'blank'; blank and desert hexes never carry a number.
const LETTER = { wood: 'w', brick: 'b', wheat: 'h', sheep: 's', ore: 'o', desert: 'd', blank: '' };
const UNLETTER = { w: 'wood', b: 'brick', h: 'wheat', s: 'sheep', o: 'ore', d: 'desert' };
const HARBOR_CODE = { '3:1': '3', wood: 'w', brick: 'b', wheat: 'h', sheep: 's', ore: 'o' };
const HARBOR_TYPE = Object.fromEntries(Object.entries(HARBOR_CODE).map(([k, v]) => [v, k]));
const PRODUCING = new Set(RESOURCES);

export function boardFrom({ setup, hexes, harbors = {} }) {
  const spec = SETUPS[setup];
  const graph = buildGraph(spec.layout);
  const hx = graph.hexes.map((h, i) => {
    const e = hexes[i] || {};
    const resource = e.resource in LETTER ? e.resource : 'blank';
    const number = PRODUCING.has(resource) && PIPS[e.number] ? e.number : null;
    return { ...h, resource, number };
  });
  const numbers = hx.map(h => h.number);
  const isBalanced = !redsTouch(graph, numbers);
  return { setup, seed: null, custom: true, balanced: isBalanced, balanceFailed: false, graph, hexes: hx, harbors: { ...harbors } };
}

export function blankBoard(setup) { return boardFrom({ setup, hexes: [], harbors: {} }); }

// Link form: one letter per hex (blank = the '-' placeholder) followed by its number if any,
// e.g. "w8b5d-o6…"; harbours as edgeId:code pairs, e.g. "12:3,40:w".
export function encodeBoard(board) {
  const b = board.hexes.map(h => (h.resource === 'blank' ? '-' : LETTER[h.resource]) + (h.number || '')).join('');
  const h = Object.entries(board.harbors).map(([eid, t]) => `${eid}:${HARBOR_CODE[t]}`).join(',');
  return { b, h };
}

export function decodeBoard(setup, b, h) {
  const spec = SETUPS[setup];
  if (!spec) return null;
  const graph = buildGraph(spec.layout);
  const parts = String(b || '').match(/[wbhsod-]\d{0,2}/g) || [];
  if (parts.join('') !== String(b || '') || parts.length !== graph.hexes.length) return null;
  const hexes = [];
  for (const p of parts) {
    const resource = p[0] === '-' ? 'blank' : UNLETTER[p[0]];
    const number = p.length > 1 ? Number(p.slice(1)) : null;
    if (number !== null && !PIPS[number]) return null;
    hexes.push({ resource, number });
  }
  const coast = new Set(graph.perimeter);
  const harbors = {};
  for (const pair of String(h || '').split(',').filter(Boolean)) {
    const m = /^(\d+):([3wbhso])$/.exec(pair);
    if (!m || !coast.has(Number(m[1]))) return null;
    harbors[Number(m[1])] = HARBOR_TYPE[m[2]];
  }
  return boardFrom({ setup, hexes, harbors });
}

// Plain-English differences between what was entered and the official box. Advice, never a block.
export function checkTiles(board) {
  const spec = SETUPS[board.setup];
  const notes = [];
  const blank = board.hexes.filter(h => h.resource === 'blank').length;
  if (blank) notes.push(`${blank} hex${blank > 1 ? 'es are' : ' is'} still blank.`);
  const have = {};
  for (const h of board.hexes) if (h.resource !== 'blank') have[h.resource] = (have[h.resource] || 0) + 1;
  for (const [r, n] of Object.entries(spec.tiles)) if ((have[r] || 0) !== n) notes.push(`${r}: ${have[r] || 0} hex${(have[r] || 0) === 1 ? '' : 'es'} entered, the box has ${n}.`);
  const want = {}; for (const t of spec.tokens) want[t] = (want[t] || 0) + 1;
  const got = {}; for (const h of board.hexes) if (h.number) got[h.number] = (got[h.number] || 0) + 1;
  for (const t of Object.keys(want).map(Number).sort((a, b) => a - b)) if ((got[t] || 0) !== want[t]) notes.push(`number ${t}: ${got[t] || 0} placed, the box has ${want[t]}.`);
  const nh = Object.keys(board.harbors).length;
  if (nh !== spec.harbors.length) notes.push(`${nh} harbour${nh === 1 ? '' : 's'} placed, the box has ${spec.harbors.length}.`);
  return notes;
}

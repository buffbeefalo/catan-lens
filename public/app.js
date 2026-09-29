import { generateBoard, randomSeed, PIPS, boardFrom, blankBoard, encodeBoard, decodeBoard, checkTiles } from './board.js';
import { hexCorners, legalVertices } from './geometry.js';
import { suggestRoad, rankSpots, compare, grade, simulateDraft, PLANS, planFor } from './score.js';
import { STAGES, stageFor, setupStage, findSeed, judge, ladderKey, tableLabel } from './drill.js';

const $ = s => document.querySelector(s);
const state = { setup: 'base', seed: 1, players: 4, seat: 1, cak: false, balanced: true, showBest: true, randomSeat: false, me: [], opp: [], history: [], mode: 'me', pick: null, drill: false, drillSetup: false, stage: 1, answered: null, attempts: 0, custom: false, customHexes: [], customHarbors: {}, tool: null, numHex: null };
let board = null, ranking = [], draft = [];
const HEUR = 'opening heuristic v1';
const MAX_LEVEL = STAGES.length + 20;   // bonus levels beyond the ladder are capped so a hand-edited link cannot draw a giant track

// ---- URL state -------------------------------------------------------------
function readUrl() {
  const q = new URLSearchParams(location.search);
  const n = (k, d) => (q.has(k) && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : d);
  state.players = [3, 4, 5, 6].includes(n('players', 4)) ? n('players', 4) : 4;
  state.setup = state.players >= 5 ? 'ext56' : 'base';
  const seedOk = q.has('seed') && /^\d{1,10}$/.test(q.get('seed')) && Number(q.get('seed')) < 4294967296;
  state.seed = seedOk ? Number(q.get('seed')) : randomSeed();   // anything malformed counts as absent
  state.seat = Math.min(state.players, Math.max(1, Math.floor(n('seat', 1))));
  state.cak = q.get('cak') === '1';
  state.balanced = q.get('bal') !== '0';
  state.showBest = q.get('best') !== '0';
  state.randomSeat = q.get('rseat') === '1';
  state.drill = q.get('drill') === '1';
  state.stage = Math.min(MAX_LEVEL, Math.max(1, Math.floor(n('level', 1))));
  if (state.drill) {
    state.stage = Math.min(state.stage, maxCleared() + 1);   // a link cannot skip ahead of your progress
    if (!seedOk) state.seed = findSeed(stageFor(state.stage, table()), randomSeed).seed;   // the level picks its board
  }
  if (!state.drill && q.has('b')) {
    const cb = decodeBoard(state.setup, q.get('b'), q.get('h') || '');
    if (cb) { state.custom = true; state.customHexes = cb.hexes.map(h => ({ resource: h.resource, number: h.number })); state.customHarbors = { ...cb.harbors }; }
  }
  if (state.randomSeat && !q.has('seat')) rollSeat();
  const ids = k => [...new Set((q.get(k) || '').split(',').filter(Boolean).map(Number).filter(x => Number.isInteger(x) && x >= 0))];
  state.me = ids('me'); state.opp = ids('opp');
  // Free play keeps the placement ORDER too (seq=o23,m13,…), so Undo and the verdicts survive a reload.
  state.seq = (q.get('seq') || '').split(',').filter(Boolean).map(t => ({ k: t[0] === 'o' ? 'opp' : 'me', id: Number(t.slice(1)), user: t[0] === 'm' })).filter(t => Number.isInteger(t.id) && t.id >= 0);
}
function writeUrl() {
  const q = new URLSearchParams({ players: state.players, seed: state.seed, seat: state.seat, cak: state.cak ? 1 : 0, bal: state.balanced ? 1 : 0, best: state.showBest ? 1 : 0, rseat: state.randomSeat ? 1 : 0 });
  if (state.drill && !state.drillSetup) { q.set('drill', 1); q.set('level', state.stage); }   // the level defines its pieces; none are written
  else {
    if (state.custom) { const enc = encodeBoard(board); q.delete('seed'); q.set('b', enc.b); if (enc.h) q.set('h', enc.h); }
    if (state.me.length) q.set('me', state.me.join(','));
    if (state.opp.length) q.set('opp', state.opp.join(','));
    if (state.history.length) q.set('seq', state.history.map(h => (h.k === 'opp' ? 'o' : 'm') + h.id).join(','));
  }
  history.replaceState(null, '', '?' + q.toString());
}

// ---- Model -----------------------------------------------------------------
function settings() { return { players: state.players, seat: state.seat, cak: state.cak }; }
const table = () => ({ players: state.players, cak: state.cak });   // the drill table you chose before starting
const inLevel = () => state.drill && !state.drillSetup;
function rollSeat() { state.seat = 1 + Math.floor(Math.random() * state.players); }
function rebuild() {
  if (inLevel()) {
    const st = stageFor(state.stage, table());
    const r = setupStage(st, state.seed);
    board = r.board;
    state.seat = st.seat; state.setup = st.players >= 5 ? 'ext56' : 'base'; state.balanced = true;
    state.me = r.me; state.opp = r.opp;
    controls();   // the bar mirrors the stage's scenario
  } else if (state.custom) board = boardFrom({ setup: state.setup, hexes: state.customHexes, harbors: state.customHarbors });
  else board = generateBoard({ setup: state.setup, seed: state.seed, balanced: state.balanced });
  const n = board.graph.vertices.length;
  const hist = !state.drill && state.seq && state.seq.length ? state.seq : [...state.opp.map(id => ({ k: 'opp', id })), ...state.me.map(id => ({ k: 'me', id }))];
  state.seq = null;
  // Replay in order; anything off the board, doubled, or illegal where it stands is dropped rather than crashing the page.
  state.me = []; state.opp = []; state.history = [];
  for (const h of hist) {
    if (!(Number.isInteger(h.id) && h.id >= 0 && h.id < n)) continue;
    if (h.k === 'me' && state.me.length >= 2) continue;
    if (!legalVertices(board.graph, [...state.me, ...state.opp]).includes(h.id)) continue;
    (h.k === 'me' ? state.me : state.opp).push(h.id); state.history.push({ k: h.k, id: h.id, user: h.user });
  }
  drawBoard();
  recompute();
}
function recompute() {
  // The second settlement is ranked against the first; once both are down the ranking is hidden.
  ranking = rankSpots(board, settings(), { mine: state.me.slice(0, 1), occupied: [...state.me, ...state.opp] });
  draft = simulateDraft(board, settings(), { me: state.me, opp: state.opp });
  if (state.pick !== null && !ranking.some(r => r.id === state.pick)) state.pick = null;
  writeUrl(); render();
}

// ---- Board drawing ---------------------------------------------------------
const NAMES = { wood: 'Wood', brick: 'Brick', wheat: 'Wheat', sheep: 'Sheep', ore: 'Ore', desert: 'Desert', blank: 'Blank' };
const el = (t, a = {}, ...kids) => { const e = document.createElementNS('http://www.w3.org/2000/svg', t); for (const k in a) e.setAttribute(k, a[k]); for (const c of kids) e.append(c); return e; };
function drawBoard() {
  const svg = $('#svg'); svg.innerHTML = '';
  const xs = board.graph.vertices.map(v => v.x), ys = board.graph.vertices.map(v => v.y);
  const padX = 0.6, padY = 0.6;   // base margin; the frame grows further to fit the harbour labels once they are measured
  const minX = Math.min(...xs) - padX, minY = Math.min(...ys) - padY, w = Math.max(...xs) - minX + padX, h = Math.max(...ys) - minY + padY;
  svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
  const g = el('g');
  for (const hx of board.hexes) {
    const pts = hexCorners(hx.x, hx.y).map(p => p.join(',')).join(' ');
    const poly = el('polygon', { class: `hex ${hx.resource}${state.custom ? ' editable' : ''}${state.custom && state.numHex === hx.id ? ' sel' : ''}`, points: pts }, el('title', {}, `${NAMES[hx.resource]}${hx.number ? ' ' + hx.number : ''}`));
    if (state.custom) poly.addEventListener('click', () => hexClick(hx.id));
    g.append(poly);
    if (hx.resource !== 'blank') g.append(el('text', { class: 'terrain-label', x: hx.x, y: hx.y + .65, 'aria-hidden': 'true' }, NAMES[hx.resource]));
    if (hx.number) {
      const red = hx.number === 6 || hx.number === 8;
      g.append(el('circle', { class: 'tok', cx: hx.x, cy: hx.y, r: 0.36 }));
      g.append(el('text', { class: 'tok-n' + (red ? ' red' : ''), x: hx.x, y: hx.y + 0.1 }, String(hx.number)));
      const n = PIPS[hx.number];
      for (let i = 0; i < n; i++) g.append(el('circle', { class: 'pip' + (red ? ' red' : ''), cx: hx.x + (i - (n - 1) / 2) * 0.09, cy: hx.y + 0.24, r: 0.03 }));
    }
  }
  svg.append(g);
  // Harbours: a dashed tie on the coastal edge plus a label out to sea. The label goes along the edge's
  // outward normal, far enough that its whole text box clears the edge line, then a little further while
  // any corner of the box still lands inside a tile (the coast bends at the board's corners). Measured in
  // user units after the text is in the document, so the real rendered width is used.
  const polys = board.hexes.map(hx => hexCorners(hx.x, hx.y));
  const inHex = (x, y) => polys.some(pts => { let inside = true; for (let i = 0; i < 6 && inside; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 6]; if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) inside = false; } return inside; });
  let lminX = Infinity, lminY = Infinity, lmaxX = -Infinity, lmaxY = -Infinity;
  for (const [eid, type] of Object.entries(board.harbors)) {
    const edge = board.graph.edges[eid];
    const [a, b] = edge.v.map(i => board.graph.vertices[i]);
    const own = board.hexes[edge.hexes[0]];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = mx - own.x, ny = my - own.y;   // on a regular hex the centre→edge-midpoint vector IS the outward edge normal
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    g.append(el('line', { class: 'harbor-line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    const t = el('text', { class: 'harbor', x: mx, y: my }, type === '3:1' ? '3:1' : `2:1 ${NAMES[type].toLowerCase()}`);
    g.append(t);
    const w = t.getComputedTextLength() + 0.1, h = 0.26;
    let d = 0.1 + Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;   // box centre distance so the nearest corner clears the edge line
    let cx, cy;
    for (let k = 0; k < 24; k++, d += 0.05) {
      cx = mx + nx * d; cy = my + ny * d;
      const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2], [0, -h / 2], [0, h / 2], [-w / 2, 0], [w / 2, 0]];
      if (!pts.some(([dx, dy]) => inHex(cx + dx, cy + dy))) break;
    }
    t.setAttribute('x', cx); t.setAttribute('y', cy + 0.08);
    lminX = Math.min(lminX, cx - w / 2); lmaxX = Math.max(lmaxX, cx + w / 2); lminY = Math.min(lminY, cy - h / 2); lmaxY = Math.max(lmaxY, cy + h / 2);
  }
  if (state.custom && state.tool === 'port') for (const eid of board.graph.perimeter) {   // every coastal edge is a tap target for a harbour
    const [a, b] = board.graph.edges[eid].v.map(i => board.graph.vertices[i]);
    const hit = el('line', { class: 'coast-hit' + (board.harbors[eid] ? '' : ' empty'), x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'data-edge': eid });
    hit.append(el('title', {}, board.harbors[eid] ? `Harbour: ${board.harbors[eid]} — tap to change` : 'Tap to add a harbour'));
    hit.addEventListener('click', () => cycleHarbor(eid));
    g.append(hit);
  }
  // Grow the frame to fit the labels (they may sit further out than the fixed padding allows).
  if (lminX < Infinity) {
    const vb = svg.viewBox.baseVal;
    const x0 = Math.min(vb.x, lminX - 0.1), y0 = Math.min(vb.y, lminY - 0.1), x1 = Math.max(vb.x + vb.width, lmaxX + 0.1), y1 = Math.max(vb.y + vb.height, lmaxY + 0.1);
    svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  }
  svg.append(el('g', { id: 'marks' }));
  svg.append(el('g', { id: 'hits' }));
  fitBoard();
}
// Two-column layout: cap the board so it fits the viewport height (the whole board and the panel
// visible on load). Single-column: full width, the page scrolls.
function fitBoard() {
  const svg = $('#svg'); const vb = svg.viewBox.baseVal;
  if (!vb || !vb.width) return;
  if (innerWidth <= 1023) { svg.style.maxWidth = ""; return; }   // single column (phones, the Fold open flat): full width, page scrolls
  const top = $('.board').getBoundingClientRect().top + scrollY;
  const style = getComputedStyle($('.board'));
  const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const avail = Math.max(280, innerHeight - top - chrome - 32);
  svg.style.maxWidth = Math.round(avail * vb.width / vb.height) + 'px';
}
addEventListener('resize', fitBoard);
function drawMarks() {
  const marks = $('#marks'), hits = $('#hits');
  const focused = document.activeElement?.classList?.contains('vx') ? document.activeElement.getAttribute('aria-label') : null;
  marks.innerHTML = ''; hits.innerHTML = '';
  const legal = new Set(legalVertices(board.graph, [...state.me, ...state.opp]));
  const v = board.graph.vertices;
  const can = canPlace();
  // The best open corner, ringed on the map (same condition as the Best card: free play, Show best on). Ties share rank 1, so every tied corner gets a ring.
  if (state.showBest && !state.drill && state.me.length < 2) for (const r of ranking.filter(r => r.score === ranking[0].score)) { const b = v[r.id]; marks.append(el('circle', { class: 'best-ring', cx: b.x, cy: b.y, r: .27, 'data-corner': b.id, role: 'img', 'aria-label': `Best open corner: ${cornerDesc(b.id)}` })); }
  if (can) for (const id of legal) marks.append(el('circle', { class: 'legal-dot', cx: v[id].x, cy: v[id].y, r: .055, 'aria-hidden': 'true' }));
  const nearby = state.pick === null ? [] : v[state.pick].hexes;
  $('#svg').querySelectorAll('.hex').forEach((hex, i) => hex.classList.toggle('related', nearby.includes(i)));
  // Projected draft: one numbered badge per seat and round (solid = first settlement, dashed = second).
  // A badge for a piece already on the board sits up-right of it so the piece stays visible.
  if (reveal() && disclosures.get('draft')) draft.forEach(d => {
    const p = v[d.id];
    const x = d.actual ? p.x + 0.26 : p.x, y = d.actual ? p.y - 0.26 : p.y, r = d.actual ? 0.17 : 0.22;
    marks.append(el('g', { class: `badge r${d.round}${d.you ? ' you' : ''}${d.actual ? ' placed' : ''}` }, el('circle', { cx: x, cy: y, r }), el('text', { x, y: y + (d.actual ? 0.08 : 0.1) }, String(d.seat))));
  });
  for (const id of state.opp) { const p = v[id]; marks.append(el('rect', { class: 'piece opp', x: p.x - 0.18, y: p.y - 0.18, width: 0.36, height: 0.36, rx: 0.05 })); }
  for (const id of state.me) { const p = v[id]; marks.append(el('path', { class: 'piece me', d: house(p.x, p.y) })); }
  if (state.pick !== null && !state.me.includes(state.pick)) { const p = v[state.pick]; marks.append(el('path', { class: 'piece pick', d: house(p.x, p.y) })); }
  // R13: the starting road each settlement should take (a hint, so only when hints are revealed)
  if (reveal()) {
    const roadFor = (id, cls) => { const r = roadHint(id); if (!r) return; const e = board.graph.edges[r.edge]; const a = v[e.v[0]], b = v[e.v[1]]; marks.append(el('line', { class: 'road ' + cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y })); };
    for (const id of state.me) roadFor(id, 'me');
    if (state.pick !== null && !state.me.includes(state.pick)) roadFor(state.pick, 'pick');
  }
  for (const p of v) {
    const ok = legal.has(p.id) && can;
    const c = el('circle', { class: 'vx ' + (ok ? 'legal' : 'dead'), cx: p.x, cy: p.y, r: 0.3, tabindex: ok ? 0 : -1, role: 'button', 'aria-label': `Corner ${p.id}`, 'aria-description': cornerDesc(p.id), 'aria-disabled': String(!ok) });
    if (ok) { c.addEventListener('click', () => place(p.id)); c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(p.id); } }); }
    hits.append(c);
    if (focused && ok && focused === `Corner ${p.id}`) queueMicrotask(() => c.focus({ preventScroll: true }));
  }
}
// R13 starting road for a settlement, against the pieces on the board right now.
const roadHint = id => suggestRoad(board, settings(), id, { mine: state.me, occupied: [...state.me, ...state.opp] });
const roadLine = id => { const r = roadHint(id); return `<p class="sub road">${esc(r ? r.text : 'No road makes progress from here: every corner two roads away is already taken.')}</p>`; };
// Can a click on the board do anything right now?
const canPlace = () => (state.tool ? false : state.mode === 'opp' ? !state.drill : state.me.length < 2 && !state.drillSetup && !(state.drill && state.answered !== null));
const house = (x, y) => `M${x - 0.2},${y + 0.18} L${x - 0.2},${y - 0.05} L${x},${y - 0.24} L${x + 0.2},${y - 0.05} L${x + 0.2},${y + 0.18} Z`;

const reveal = () => (state.drill ? state.answered !== null : state.showBest);

// Level progress lives in this browser only (no account, no server): which levels are cleared.
// One track per table (players + Cities & Knights): { ladders: { '4-base': [1, 2, …], '6-cak': [1] } }.
// The pre-2026-09-15 shape ({ cleared: [...] }) belonged to a ladder that mixed tables and is not carried over.
const PROG_KEY = 'catan-lens.levels';
function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY) || '{}');
    const ladders = {};
    if (p && p.ladders && typeof p.ladders === 'object') for (const [k, v] of Object.entries(p.ladders)) if (Array.isArray(v)) ladders[k] = v.filter(Number.isInteger);
    return { ladders };
  } catch { return { ladders: {} }; }
}
function saveProgress(p) { try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch { /* private mode etc. — progress just does not persist */ } }
let progress = loadProgress();
addEventListener('storage', e => { if (e.key === PROG_KEY) { progress = loadProgress(); if (state.drill) render(); } });
const cleared = () => progress.ladders[ladderKey(table())] || [];
function markCleared(n) { const k = ladderKey(table()); progress.ladders[k] = [...cleared(), n]; saveProgress(progress); }
const maxCleared = () => cleared().reduce((m, x) => Math.max(m, x), 0);
const unlocked = n => n <= maxCleared() + 1;
function gotoLevel(n) { state.stage = n; state.attempts = 0; newStageBoard(); }

// ---- Drill (stages) -----------------------------------------------------------
let freePlay = null;   // the settings you had before entering the drill
function newStageBoard() {
  const st = stageFor(state.stage, table());
  const f = findSeed(st, randomSeed);
  state.seed = f.seed; state.seedFallback = f.fallback;
  state.answered = null; state.pick = null; state.mode = 'me';
  controls(); rebuild();
}
// Drill on = set your table first (players + C&K stay live in the bar, everything else locks); Start begins
// the ladder at the next open level for that table. A drill=1&level=N link skips the setup and uses its table.
function setDrill(on) {
  if (on && state.custom) { state.custom = false; state.tool = null; state.numHex = null; }
  state.drill = on; state.drillSetup = on; state.answered = null; state.attempts = 0; state.pick = null; state.mode = 'me';
  state.me = []; state.opp = []; state.history = [];
  if (on) { freePlay = { players: state.players, seat: state.seat, cak: state.cak, balanced: state.balanced, setup: state.setup }; controls(); rebuild(); }
  else { if (freePlay) Object.assign(state, freePlay); freePlay = null; state.seed = randomSeed(); controls(); rebuild(); }
}
// ---- Your board (enter the board in front of you) -----------------------------
const HARBOR_CYCLE = [null, '3:1', 'wood', 'brick', 'wheat', 'sheep', 'ore'];
function setCustom(on) {
  if (on && state.drill) setDrill(false);
  state.custom = on; state.tool = null; state.numHex = null; state.pick = null;
  if (on) { state.customHexes = board.hexes.map(h => ({ resource: h.resource, number: h.number })); state.customHarbors = { ...board.harbors }; }   // start from the board on screen
  else state.seed = randomSeed();
  controls(); rebuild();
}
function setTool(t) { state.tool = state.tool === t ? null : t; state.numHex = null; state.pick = null; controls(); rebuild(); }
function hexClick(i) {
  if (!state.tool || state.tool === 'port') return;
  if (state.tool === 'number') { state.numHex = state.numHex === i ? null : i; rebuild(); return; }
  const h = state.customHexes[i] || (state.customHexes[i] = { resource: 'blank', number: null });
  h.resource = state.tool; if (state.tool === 'desert' || state.tool === 'blank') h.number = null;
  rebuild();
}
function setNumber(n) { const h = state.customHexes[state.numHex]; if (!h) return; h.number = n; rebuild(); }
function cycleHarbor(eid) { const cur = state.customHarbors[eid] || null; const next = HARBOR_CYCLE[(HARBOR_CYCLE.indexOf(cur) + 1) % HARBOR_CYCLE.length]; if (next) state.customHarbors[eid] = next; else delete state.customHarbors[eid]; rebuild(); }
function fillCustom(b) { state.customHexes = b.hexes.map(h => ({ resource: h.resource, number: h.number })); state.customHarbors = { ...b.harbors }; state.numHex = null; state.me = []; state.opp = []; state.history = []; state.pick = null; rebuild(); }

function startDrill() { $('#settings').open = false; state.drillSetup = false; state.stage = Math.min(MAX_LEVEL, maxCleared() + 1); state.attempts = 0; newStageBoard(); }
function nextStage() { state.stage = Math.min(MAX_LEVEL, state.stage + 1); state.attempts = 0; newStageBoard(); }

// ---- Interaction -----------------------------------------------------------
function place(id) {
  if (state.drill && state.answered !== null) return;   // one placement per level; scramble or advance to continue
  if (state.mode === 'opp') { state.opp.push(id); state.history.push({ k: 'opp', id }); state.pick = null; recompute(); return; }
  if (state.me.length >= 2) return;
  previewPick(id);
}
function previewPick(id) {
  if (!canPlace() || !ranking.some(r => r.id === id)) return;
  state.pick = id; render();
  requestAnimationFrame(() => {
    const keep = $('#keep');
    if (state.pick !== id || !keep || Number(keep.dataset.corner) !== id) return;
    keep.focus({ preventScroll: true });
    const rect = keep.getBoundingClientRect();
    if (rect.top < 12 || rect.bottom > innerHeight - 12) keep.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
}
function cancelPick() {
  const id = state.pick;
  state.pick = null; render();
  $(`#hits .vx.legal[aria-label="Corner ${id}"]`)?.focus();
}
function keepPick() {
  if (state.pick === null) return;
  if (state.drill && state.answered !== null) return;   // the level is answered; scramble or advance
  if (state.drill) {
    const r = ranking.find(x => x.id === state.pick);
    const g = grade(r, ranking, state.players);
    state.answered = { ...judge(stageFor(state.stage, table()), g), g }; state.attempts += 1;
    if (state.answered.pass && !cleared().includes(state.stage)) markCleared(state.stage);
  }
  state.me.push(state.pick); state.history.push({ k: 'me', id: state.pick, user: true }); state.pick = null; recompute();
}
// Undo reverses the LAST action, whichever kind it was (a pending preview first).
function undo() {
  if (state.pick !== null) { state.pick = null; render(); return; }
  const last = state.history.pop();
  if (!last) return;
  if (last.k === 'me') state.me = state.me.filter(x => x !== last.id);
  else { const i = state.opp.lastIndexOf(last.id); if (i >= 0) state.opp.splice(i, 1); }
  recompute();
}
function reset() { state.me = []; state.opp = []; state.history = []; state.pick = null; recompute(); }

// ---- Panel -----------------------------------------------------------------
// Grade each placed settlement against the corners that were open when it went down (replayed
// from the action history), so the verdict survives later placements and reloads.
function placedVerdicts() {
  const out = [];
  const seen = [];
  for (const h of state.history) {
    if (h.k === 'me' && (!state.drill || h.user)) {
      const mine = seen.filter(x => x.k === 'me').map(x => x.id);
      const rk = rankSpots(board, settings(), { mine, occupied: seen.map(x => x.id) });
      const r = rk.find(x => x.id === h.id);
      if (r) out.push({ r, g: grade(r, rk, state.players), diff: compare(rk[0], r), n: mine.length + 1 });
    }
    seen.push(h);
  }
  return out;
}
const verdictCard = ({ r, g, diff, n }, heading) => html`<div class="card verdict ${g.tier}"><h2>${heading} <span>#${g.rank} of ${g.total} · ${g.pct}% of best</span></h2>
      <p class="grade"><b>${g.label}</b> — ${esc(g.why)}</p>
      <p class="sub">${esc(describe(r))}</p>${reasons(r)}${roadLine(r.id)}
      ${diff.length ? `<p class="sub"><b>What the best corner had that this lacks:</b></p><ul class="why">${diff.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      <div class="stat"><span>Score <b>${r.score.toFixed(1)}</b></span><span>Pips <b>${r.pips}</b></span></div></div>`;
const list = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const describe = r => `${list(Object.entries(r.prod).map(([k, p]) => `${p} ${k}`))}${r.numbers.length ? ' · numbers ' + r.numbers.slice().sort((a, b) => a - b).join(', ') : ''}`;
function cornerDesc(id) {
  const prod = {}, numbers = [];
  for (const h of board.graph.vertices[id].hexes) { const x = board.hexes[h]; if (x.number) { prod[x.resource] = (prod[x.resource] || 0) + PIPS[x.number]; numbers.push(x.number); } }
  return numbers.length ? describe({ prod, numbers }) : 'no production';
}
function payout(ids) {
  const nums = new Set();
  for (const id of ids) for (const h of board.graph.vertices[id].hexes) if (board.hexes[h].number) nums.add(board.hexes[h].number);
  return [...nums].reduce((s, n) => s + PIPS[n], 0);
}
function html(strings, ...vals) { return strings.reduce((s, x, i) => s + x + (vals[i] ?? ''), ''); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function reasons(r) { return `<ul class="why">${r.parts.map(p => `<li class="${p.v !== null && p.v < 0 ? 'neg' : ''}">${esc(p.text)}</li>`).join('')}</ul>`; }

const disclosures = new Map();
function render() {
  for (const details of $('#panel').querySelectorAll('details[data-disclosure]')) disclosures.set(details.dataset.disclosure, details.open);
  const plan = PLANS[planFor(settings())];
  $('#plan-note').textContent = `${plan.label}${state.cak ? ' (weighting only — no knights, commodities or barbarians simulated)' : ''} · ${HEUR} · not a win probability${board.balanceFailed ? ' · 6 and 8 could not be separated for this seed' : ''}${board.custom ? ' · your board' : ''}`;
  drawMarks();
  const panel = $('#panel');
  const best = ranking[0];
  const stage = state.me.length === 0 ? 'first' : state.me.length === 1 ? 'second' : 'done';
  const total = ranking.length;
  $('#table-summary').textContent = `${state.players} players · Seat ${state.seat} · ${state.cak ? 'C&K' : 'Base'}`;
  $('#showbest').textContent = state.drill ? (state.answered ? 'Answers shown' : 'Hints hidden') : 'Show best';
  $('#showbest').setAttribute('aria-pressed', String(reveal()));
  let out = '';

  if (state.drillSetup) {
    const done = cleared().filter(x => x <= STAGES.length).length;
    out += html`<div class="card drill lead"><h2>Drill <span>set your table first</span></h2>
      <p class="sub">Open <b>Table settings</b> above to choose <b>Players</b> (3 to 6) and <b>Cities &amp; Knights</b>. Every one of the ${STAGES.length} levels then runs on that table; each table keeps its own progress.</p>
      <p class="setup-table"><b>${esc(tableLabel(table()))}</b> · ${done ? `${done} of ${STAGES.length} cleared, you resume at level ${Math.min(MAX_LEVEL, maxCleared() + 1)}` : 'fresh ladder, you start at level 1'}</p>
      <p style="margin:10px 0 0"><button class="btn" id="start-drill">Start the ${STAGES.length} levels</button></p></div>`;
  } else if (state.drill) {
    const st = stageFor(state.stage, table());
    const before = st.task === 'first' ? (st.seat === 1 ? 'You pick first.' : `${st.seat - 1} ${st.seat === 2 ? 'opponent has' : 'opponents have'} already placed (white squares).`) : st.seat === st.players ? 'Every first settlement is down and, as last seat, you pick your second first.' : 'Every first settlement is down and the seats after you have taken their second.';
    const a = state.answered;
    out += html`<div class="card drill ${a ? (a.pass ? 'pass' : 'fail') : ''}"><h2>Level ${state.stage}${state.stage <= STAGES.length ? ` of ${STAGES.length}` : ' · bonus'} <span>${esc(st.title)}${state.stage > STAGES.length ? ' · the hardest level repeats with new boards' : ''}</span></h2>
      <p class="sub">${st.players} players · you are seat ${st.seat}${st.cak ? ' · Cities &amp; Knights weighting' : ''}. ${before} Place your <b>${st.task}</b> settlement. To clear it: land on ${st.pass.top === 1 ? '<b>the best corner</b>' : `<b>one of the top ${st.pass.top} corners</b>`}.${state.attempts ? ` Attempt ${state.attempts + (a ? 0 : 1)}.` : ''}${state.seedFallback ? ' (No board in this level\u2019s usual difficulty band was found; this one is close.)' : ''}</p>
      ${a ? `<p class="grade"><b>${a.pass ? 'Level cleared' : 'Not this time'}</b> — ${esc(a.text)}</p><p style="margin:10px 0 0">${a.pass ? `<button class="btn" id="next-stage">${state.stage === STAGES.length ? 'All 16 cleared — bonus level' : state.stage >= MAX_LEVEL ? 'Another board at the top' : 'Next level'}</button>` : '<button class="btn" id="scramble">New board, same level</button>'}</p>` : '<p class="sub" style="margin:0">Hints are hidden until you commit. Click a corner, then Keep.</p>'}</div>`;
    const top = Math.min(MAX_LEVEL, Math.max(STAGES.length, state.stage, maxCleared()));
    const cl0 = cleared();
    out += html`<div class="card"><h2>Levels <span>${cl0.filter(x => x <= STAGES.length).length} of ${STAGES.length} cleared · ${esc(tableLabel(table()))}</span></h2>
      <ol class="track">${Array.from({ length: top }, (_, i) => i + 1).map(n => { const cl = cl0.includes(n), cur = n === state.stage, open = unlocked(n) || cur; return `<li class="${cl ? 'cleared' : ''}${cur ? ' current' : ''}${open || cl ? '' : ' locked'}" data-level="${n}" title="${esc(stageFor(n, table()).title)}" aria-current="${cur}">${cl ? '⚑' : n}</li>`; }).join('')}</ol>
      <p class="sub" style="margin:8px 0 0">Easy on the left, hard on the right. A flag is a cleared level; you can replay any of them. Progress is kept per table. <a href="#" id="restart-levels">Start this table over</a></p></div>`;
  } else {
    if (state.custom) {
      const notes = checkTiles(board);
      const sel = state.numHex !== null ? board.hexes[state.numHex] : null;
      const tools = [['wood', 'Wood'], ['brick', 'Brick'], ['wheat', 'Wheat'], ['sheep', 'Sheep'], ['ore', 'Ore'], ['desert', 'Desert'], ['number', 'Numbers'], ['port', 'Ports']];
      out += html`<div class="card edit lead"><h2>Your board <span>enter the board in front of you</span></h2>
        <p class="sub">Pick a paint, then tap hexes. <b>Numbers</b>: tap a hex, then its token. <b>Ports</b>: tap a coastal edge to cycle 3:1, wood, brick, wheat, sheep, ore, none. The ranking updates as you go and the link carries the board.</p>
        <div class="palette">${tools.map(([k, l]) => `<button class="toggle" id="tool-${k}" aria-pressed="${state.tool === k}">${l}</button>`).join('')}</div>
        ${state.tool === 'number' ? (sel ? (sel.resource === 'blank' || sel.resource === 'desert' ? `<p class="sub">That hex is ${sel.resource}; paint a resource on it first.</p>` : `<p class="sub" style="margin:0 0 4px">Token for the ${esc(NAMES[sel.resource].toLowerCase())} hex:</p><span class="seg picker" role="group" aria-label="Number token">${[2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map(n => `<button data-num="${n}" aria-pressed="${sel.number === n}">${n}</button>`).join('')}<button data-num="0" aria-pressed="${!sel.number}">none</button></span>`) : '<p class="sub">Tap a hex to set its number.</p>') : ''}
        <p class="sub check ${notes.length ? '' : 'ok'}">${notes.length ? notes.map(esc).join(' ') : 'Matches the official box.'}${board.balanced ? '' : ' 6 and 8 share an edge.'}</p>
        <p style="margin:8px 0 0"><button class="btn ghost" id="blank-board">Start blank</button> <button class="btn ghost" id="rand-board">Random board</button></p></div>`;
    }
    out += html`<div class="card"><div class="modes">
    <span class="seg" role="group" aria-label="Who are you placing?">
      <button id="mode-me" aria-pressed="${state.mode === 'me'}">Place mine</button>
      <button id="mode-opp" aria-pressed="${state.mode === 'opp'}">Mark opponent</button></span>
    <span><button class="btn ghost" id="undo">Undo</button> <button class="btn ghost" id="reset">Clear</button></span></div>
    <p class="sub" style="margin:10px 0 0">${stage === 'first' ? 'Click any open corner to try it as your first settlement. Mark opponents’ pieces as they place so the ranking only counts what is still open.' : stage === 'second' ? 'Now the second settlement: the ranking rewards corners that patch what your first one lacks.' : 'Both settlements are down. Undo to try a different second corner.'}</p></div>`;
  }

  if (stage !== 'done' && best && state.showBest && !state.drill) {
    const ties = ranking.filter(r => r.score === best.score).length;
    out += html`<div class="card best-card"><h2>Best ${stage} settlement <span>#1 of ${total}${ties > 1 ? ` · tied with ${ties - 1} other${ties > 2 ? 's' : ''}` : ''}</span></h2>
      <p class="sub">${esc(describe(best))}</p>
      ${state.mode === 'me' && !state.tool ? '<button class="btn ghost preview-best" id="preview-best">Try this corner</button>' : ''}
      <details class="analysis-details" data-disclosure="best"><summary>Why this corner?</summary>
      ${reasons(best)}${roadLine(best.id)}
      <div class="stat"><span>Score <b>${best.score.toFixed(1)}</b></span><span>Pips <b>${best.pips}</b></span>${stage === 'second' ? `<span>Starting cards <b>${esc(list(best.startingCards) || 'none')}</b></span>` : ''}</div></details></div>`;
  }

  if (state.pick !== null && stage !== 'done') {
    const r = ranking.find(x => x.id === state.pick);
    const idx = ranking.indexOf(r) + 1;
    const diff = compare(best, r);
    const g = grade(r, ranking, state.players);
    out += html`<div class="card pick-card"><h2>Your pick <span>${reveal() ? `#${g.rank} of ${total} · ${g.pct}% of best` : 'preview'}</span></h2>
      ${reveal() ? `<p class="grade"><b>${g.label}</b> — ${esc(g.why)}</p>` : ''}
      <p class="sub" id="pick-resources">${esc(describe(r))}</p>
      <div class="pick-actions"><button class="btn" id="keep" data-corner="${r.id}" aria-describedby="pick-resources">Keep as ${stage} settlement</button><button class="btn ghost" id="cancel-pick">Cancel</button></div>
      ${reveal() ? '<details class="analysis-details" data-disclosure="pick"><summary>Why this corner?</summary>' + reasons(r) : `<p class="sub">${state.drill ? 'Score and reasons appear once you commit.' : 'Turn on <b>Show best</b> for the score and reasons, or commit to see the verdict.'}</p>`}
      ${!reveal() ? '' : g.rank === 1 ? `<p class="sub"><b>${idx === 1 ? 'That is the top corner.' : 'Tied with the top corner.'}</b></p>` : `<p class="sub"><b>What #1 has that this lacks</b> (${(best.score - r.score).toFixed(1)} points behind):</p><ul class="why">${(diff.length ? diff : ['Same production, but #1\u2019s resources weigh more on this board: scarcer, or more valuable under the current plan.']).map(d => `<li>${esc(d)}</li>`).join('')}</ul>`}
      ${reveal() ? roadLine(r.id) : ''}
      ${reveal() ? `<div class="stat"><span>Score <b>${r.score.toFixed(1)}</b></span><span>Pips <b>${r.pips}</b></span>${stage === 'second' ? `<span>Starting cards <b>${esc(list(r.startingCards) || 'none')}</b></span>` : ''}</div>` : ''}
      ${reveal() ? '</details>' : ''}</div>`;
  }

  placedVerdicts().forEach(v => { out += verdictCard(v, `Your ${v.n === 1 ? 'first' : 'second'} settlement`); });

  if (stage === 'done') {
    const prod = {};
    for (const id of state.me) for (const h of board.graph.vertices[id].hexes) { const x = board.hexes[h]; if (x.number) prod[x.resource] = (prod[x.resource] || 0) + PIPS[x.number]; }
    const missing = ['wood', 'brick', 'wheat', 'sheep', 'ore'].filter(r => !prod[r]);
    const p = payout(state.me);
    out += html`<div class="card"><h2>Your opening</h2>
      <p class="sub">${esc(list(Object.entries(prod).map(([k, v]) => `${v} ${k}`)))}</p>
      <div class="stat"><span>Total pips <b>${Object.values(prod).reduce((s, x) => s + x, 0)}</b></span><span>Produces on <b>${p} of 36</b> rolls (${Math.round(p / 36 * 100)}%)</span><span>Missing <b>${esc(list(missing) || 'nothing')}</b></span></div>
      <p class="sub" style="margin-top:10px">Tournament players aim for both settlements to add up to 20+ pips with four or five resources covered and few repeated numbers.</p></div>`;
  }

  if (reveal() && draft.length) {
    const canPick = d => !d.actual && state.mode === 'me' && stage !== 'done' && !(state.drill && state.answered !== null);
    out += html`<div class="card"><details class="draft-details" data-disclosure="draft"><summary>Projected placements</summary>
      <p class="sub">Seats pick 1 to ${state.players}, then back from ${state.players} to 1. Solid badges are first settlements, dashed are second. Your settlements and any opponent marks are counted in turn order; the rest is projected.</p>
      <ol class="rank draft">${draft.map(d => `<li data-id="${canPick(d) ? d.id : ''}" class="${d.you ? 'you' : ''}${canPick(d) ? '' : ' fixed'}" aria-current="${state.pick === d.id}" >${canPick(d) ? '<button class="draft-choice">' : ''}<span class="n">${d.seat}${d.round === 2 ? '′' : ''}</span><span>${d.you ? '<b>You</b> · ' : ''}${esc(cornerDesc(d.id))}</span><span class="s">${d.actual ? 'placed' : d.score.toFixed(1)}</span>${canPick(d) ? '</button>' : ''}</li>`).join('')}</ol></details></div>`;
  }

  out += html`<div class="card"><details data-disclosure="method"><summary>How the ranking works</summary>
    <p>Production (pips on the surrounding number tokens) is the base score, weighted by how valuable each resource is under the ${esc(plan.label.toLowerCase())} and how scarce it is on this particular board. Bonuses are small on purpose: wood+brick or wheat+ore together, a port you can actually feed, room to grow two roads away, and (for the second settlement) covering resources your first one lacks. Repeating a number costs a little. No robber penalty: game data shows 6s and 8s deliver their pips. The Cities &amp; Knights switch only re-weights these same terms (ore, wheat, wood and commodity hexes up, brick and ports down); it does not simulate the starting city, commodities, knights or barbarians. The ordering principles are the experts'; the exact weights are ours, tuned so production stays dominant.</p>
    <p>Every rule comes from what strong players publish — the King of Catan expert group, Colonist.io guides, the Cities &amp; Knights strategy guide and a 400-game statistical check. The full source table is in <a href="docs/RESEARCH.md" target="_blank" rel="noopener">docs/RESEARCH.md</a>. This is an opening heuristic, not a win probability.</p></details></div>`;

  panel.innerHTML = out;
  const pickCard = panel.querySelector('.pick-card');
  if (pickCard) panel.prepend(pickCard);
  for (const details of panel.querySelectorAll('details[data-disclosure]')) {
    const key = details.dataset.disclosure;
    details.open = disclosures.get(key) || false;
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      const changed = disclosures.get(key) !== details.open;
      disclosures.set(key, details.open);
      if (key === 'draft' && changed) drawMarks();
    });
  }
  if (!state.drill) {
    $('#mode-me').onclick = () => { state.mode = 'me'; render(); };
    $('#mode-opp').onclick = () => { state.mode = 'opp'; state.pick = null; render(); };
    $('#undo').onclick = undo; $('#reset').onclick = reset;
  }
  const nx = $('#next-stage'); if (nx) nx.onclick = nextStage;
  const sc = $('#scramble'); if (sc) sc.onclick = newStageBoard;
  for (const li of panel.querySelectorAll('.track li')) if (!li.classList.contains('locked')) li.onclick = () => gotoLevel(Number(li.dataset.level));
  const rs = $('#restart-levels'); if (rs) rs.onclick = e => { e.preventDefault(); delete progress.ladders[ladderKey(table())]; saveProgress(progress); gotoLevel(1); };
  const sd = $('#start-drill'); if (sd) sd.onclick = startDrill;
  for (const b of panel.querySelectorAll('.palette button')) b.onclick = () => setTool(b.id.slice('tool-'.length));
  for (const b of panel.querySelectorAll('.picker button')) b.onclick = () => setNumber(Number(b.dataset.num) || null);
  const bb = $('#blank-board'); if (bb) bb.onclick = () => fillCustom(blankBoard(state.setup));
  const rb = $('#rand-board'); if (rb) rb.onclick = () => fillCustom(generateBoard({ setup: state.setup, seed: randomSeed(), balanced: true }));
  const keep = $('#keep'); if (keep) keep.onclick = keepPick;
  const previewBest = $('#preview-best'); if (previewBest) previewBest.onclick = () => previewPick(best.id);
  const cancel = $('#cancel-pick'); if (cancel) cancel.onclick = cancelPick;
  for (const li of panel.querySelectorAll('.rank li')) {
    li.onclick = () => { if (state.mode === 'me' && li.dataset.id !== '') previewPick(Number(li.dataset.id)); };
  }
  fitBoard();   // the header note may have wrapped and moved the board
}

// ---- Controls ----------------------------------------------------------------
function seg(id, values, current, onpick) {
  const s = $(id); s.innerHTML = '';
  for (const v of values) { const b = document.createElement('button'); b.textContent = v; b.setAttribute('aria-pressed', String(v === current)); b.onclick = () => onpick(v); s.append(b); }
}
function controls() {
  seg('#players', [3, 4, 5, 6], state.players, v => { state.players = v; state.setup = v >= 5 ? 'ext56' : 'base'; state.seat = Math.min(state.seat, v); if (state.randomSeat) rollSeat(); state.me = []; state.opp = []; state.history = []; state.pick = null; controls(); rebuild(); });
  seg('#seat', Array.from({ length: state.players }, (_, i) => i + 1), state.seat, v => { state.seat = v; controls(); recompute(); });
  for (const b of $('#seat').querySelectorAll('button')) b.disabled = state.randomSeat;
  $('#seat').closest('.ctl').classList.toggle('muted', state.randomSeat);
  $('#showbest').setAttribute('aria-pressed', String(state.showBest));
  $('#randseat').setAttribute('aria-pressed', String(state.randomSeat));
  $('#cak').setAttribute('aria-pressed', String(state.cak));
  $('#balanced').setAttribute('aria-pressed', String(state.balanced));
  $('#seed').value = state.seed;
  $('#drill').setAttribute('aria-pressed', String(state.drill));
  $('#practice').setAttribute('aria-pressed', String(!state.drill && !state.custom));
  $('#custom').setAttribute('aria-pressed', String(state.custom)); $('#custom').disabled = state.drill;
  for (const b of $('#players').querySelectorAll('button')) b.disabled = inLevel();
  for (const b of $('#seat').querySelectorAll('button')) b.disabled = state.drill || state.randomSeat;
  $('#cak').disabled = inLevel();
  for (const id of ['#balanced', '#showbest', '#randseat', '#seed']) $(id).disabled = state.drill;
  $('#seed').disabled = state.drill || state.custom; $('#balanced').disabled = state.drill || state.custom;
  $('#new').textContent = inLevel() ? 'New board, same level' : state.custom ? 'Random board' : 'New board';
}
$('#cak').onclick = () => { state.cak = !state.cak; controls(); recompute(); };
$('#showbest').onclick = () => { state.showBest = !state.showBest; controls(); recompute(); };
$('#randseat').onclick = () => { state.randomSeat = !state.randomSeat; if (state.randomSeat) rollSeat(); controls(); recompute(); };
$('#balanced').onclick = () => { state.balanced = !state.balanced; state.me = []; state.opp = []; state.history = []; state.pick = null; controls(); rebuild(); };
$('#drill').onclick = () => setDrill(!state.drill);
$('#practice').onclick = () => { if (state.drill) setDrill(false); else if (state.custom) setCustom(false); };
$('#custom').onclick = () => setCustom(!state.custom);
$('#settings').addEventListener('toggle', fitBoard);
$('#panel').addEventListener('keydown', e => { if (e.key === 'Escape' && state.pick !== null && e.target.closest('.pick-card')) { e.preventDefault(); cancelPick(); } });
$('#new').onclick = () => { if (inLevel()) return newStageBoard(); if (state.custom) return fillCustom(generateBoard({ setup: state.setup, seed: randomSeed(), balanced: true })); state.seed = randomSeed(); if (state.randomSeat) rollSeat(); state.me = []; state.opp = []; state.history = []; state.pick = null; controls(); rebuild(); };
$('#seed').onchange = e => { const t = e.target.value.trim(); if (/^\d{1,10}$/.test(t) && Number(t) < 4294967296) { state.seed = Number(t); state.answered = null; state.me = []; state.opp = []; state.history = []; state.pick = null; controls(); rebuild(); } else controls(); };
$('#share').onclick = async () => { try { await navigator.clipboard.writeText(location.href); $('#share').textContent = 'Copied'; setTimeout(() => { $('#share').textContent = 'Copy link'; }, 1500); } catch { prompt('Copy this link', location.href); } };

readUrl(); controls(); rebuild();

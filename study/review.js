// Blinded review page (study/review.html) for study A, and the unaided tests of study B (`review.html?form=A`, B or C).
// It shows one held-out position at a time with numbered corners. It loads the board and geometry code and the
// positions file only: no ranking, score or explanation code, so it cannot show what either Catan Lens policy would
// choose (test/study-review.test.js checks every file it loads). Answers stay in this browser until the reviewer
// downloads them; nothing is sent anywhere. The helpers below are shared with study/analyze.mjs, so the page and the
// analysis apply the same rules.
import POSITIONS from './positions-2026-10-12.json' with { type: 'json' };
import { boardFrom, PIPS } from '../public/board.js';
import { hexCorners, legalVertices, nearestVertex } from '../public/geometry.js';

export const KIND = 'catan-lens-study-answers';
const MAX_REASON = 800;
const isInt = x => Number.isInteger(x);

const BOARDS = new WeakMap();
export function boardOf(position) {
  let board = BOARDS.get(position);
  if (!board) BOARDS.set(position, board = boardFrom({ setup: position.setup, hexes: position.hexes, harbors: position.harbors }));
  return board;
}

// Corners (numbered from 1) still open under the distance rule once the placed pieces and `extra` corners are down.
export function openCorners(position, extra = []) {
  const taken = [...position.placed.map(x => x.corner), ...extra].map(n => n - 1);
  return legalVertices(boardOf(position).graph, taken).map(id => id + 1);
}

// Keep only what the rules allow: an open corner as the choice; for a first-settlement task, a planned second that is
// still legal next to it; alternatives that are open corners other than the choice; confidence 1 to 5; short text.
export function cleanAnswer(position, answer = {}) {
  const open = new Set(openCorners(position));
  const choice = isInt(answer.choice) && open.has(answer.choice) ? answer.choice : null;
  const plannedSecond = position.task === 'first' && choice !== null && isInt(answer.plannedSecond)
    && openCorners(position, [choice]).includes(answer.plannedSecond) ? answer.plannedSecond : null;
  const acceptable = [...new Set((Array.isArray(answer.acceptable) ? answer.acceptable : []).filter(n => isInt(n) && open.has(n) && n !== choice))].sort((a, b) => a - b);
  const confidence = isInt(answer.confidence) && answer.confidence >= 1 && answer.confidence <= 5 ? answer.confidence : null;
  const reasoning = typeof answer.reasoning === 'string' ? answer.reasoning.trim().slice(0, MAX_REASON) : '';
  return { choice, plannedSecond, acceptable, confidence, reasoning };
}

// What a corner touches, in the words a player would use: "wheat 6, ore 10, sheep 4, 3:1 harbour".
export function describeCorner(position, n) {
  const board = boardOf(position), v = board.graph.vertices[n - 1];
  const tiles = v.hexes.map(h => board.hexes[h]).map(h => (h.number ? `${h.resource} ${h.number}` : h.resource));
  const ports = v.edges.map(e => board.harbors[e]).filter(Boolean).map(t => (t === '3:1' ? '3:1 harbour' : `2:1 ${t} harbour`));
  return [...tiles, ...ports].join(', ');
}

// The file a reviewer downloads (study/templates/answers.schema.json). Only positions with a chosen corner go in.
export function answerFile({ data = POSITIONS, code = '', answers = {}, form = null, now = new Date(), synthetic = false, note }) {
  const list = data.positions.filter(p => answers[p.id]).map(p => ({ position: p.id, ...cleanAnswer(p, answers[p.id]) })).filter(a => a.choice !== null);
  return { kind: KIND, positions: data.version, study: form ? 'learning-test' : 'expert-review', synthetic, ...(note ? { note } : {}),
    reviewer: String(code).trim().slice(0, 40), form, exportedAt: now.toISOString(), answers: list };
}

// Which positions the page shows: one learning test form (`?form=A`, B or C), or every position for the expert review.
export function pickForm(requested, data = POSITIONS) {
  const form = requested && Object.hasOwn(data.learningForms, requested) ? requested : null;
  return { form, list: form ? data.positions.filter(p => data.learningForms[form].includes(p.id)) : data.positions };
}

// ---- The page (runs only in a browser) ---------------------------------------------------------------------------
if (typeof document !== 'undefined') start();

function start() {
  const $ = s => document.querySelector(s);
  const NAMES = { wood: 'Wood', brick: 'Brick', wheat: 'Wheat', sheep: 'Sheep', ore: 'Ore', desert: 'Desert' };
  const requested = new URLSearchParams(location.search).get('form');
  const { form, list } = pickForm(requested);
  const KEY = `catan-lens-study.${POSITIONS.version}.${form || 'review'}`;
  let state = load(), tap = 'choice', stored = true, changedSinceDownload = false;

  function load() {
    const empty = { code: '', answers: {}, at: list[0].id };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved.answers === 'object' && saved.answers) return { code: String(saved.code || ''), answers: saved.answers, at: list.some(p => p.id === saved.at) ? saved.at : list[0].id };
    } catch { /* unreadable or blocked storage: start empty */ }
    return empty;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); stored = true; } catch { stored = false; }
    $('#storage').textContent = stored ? 'Your answers are kept in this browser until you clear them.'
      : 'This browser is not saving your answers. Keep this page open and download your answers before you close it.';
    $('#storage').classList.toggle('warn', !stored);
  }
  const say = text => { $('#status').textContent = text; };
  const current = () => list.find(p => p.id === state.at);
  const answerFor = p => ({ ...cleanAnswer(p, state.answers[p.id]), reasoning: state.answers[p.id]?.reasoning ?? '' });
  const seats = arr => (arr.length === 1 ? `seat ${arr[0]}` : `seats ${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

  function taskText(p) {
    const before = p.placed.map(x => x.seat);
    if (p.task === 'first') return `You are seat ${p.seat} of ${p.players}. ${before.length ? `${seats(before).replace(/^s/, 'S')} ${before.length === 1 ? 'has' : 'have'} placed a first settlement.` : 'Nothing is placed yet: you go first.'} Choose your first settlement.`;
    const seconds = before.slice(p.players);
    return `You are seat ${p.seat} of ${p.players}. Every player, you included, has placed a first settlement${seconds.length ? `, and ${seats(seconds)} ${seconds.length === 1 ? 'has' : 'have'} placed a second settlement` : ''}. Choose your second settlement: it earns one resource card from each tile next to it.`;
  }

  function drawBoard(p, a) {
    const svg = $('#board'), board = boardOf(p), g = board.graph;
    const el = (t, attrs = {}, ...kids) => { const e = document.createElementNS(svg.namespaceURI, t); for (const k in attrs) e.setAttribute(k, attrs[k]); e.append(...kids); return e; };
    svg.replaceChildren();
    const layer = el('g');
    svg.append(layer);
    for (const h of board.hexes) {
      layer.append(el('polygon', { class: `hex ${h.resource}`, points: hexCorners(h.x, h.y).map(q => q.join(',')).join(' ') }));
      layer.append(el('text', { class: 'terrain-label', x: h.x, y: h.y + 0.65 }, NAMES[h.resource]));
      if (!h.number) continue;
      const red = h.number === 6 || h.number === 8;
      layer.append(el('circle', { class: 'tok', cx: h.x, cy: h.y, r: 0.36 }), el('text', { class: 'tok-n' + (red ? ' red' : ''), x: h.x, y: h.y + 0.1 }, String(h.number)));
      for (let i = 0; i < PIPS[h.number]; i++) layer.append(el('circle', { class: 'pip' + (red ? ' red' : ''), cx: h.x + (i - (PIPS[h.number] - 1) / 2) * 0.09, cy: h.y + 0.24, r: 0.03 }));
    }
    // Harbours as on the main page: a dashed tie on the coastal edge and a label pushed out to sea until it clears the tiles.
    const xs = g.vertices.map(v => v.x), ys = g.vertices.map(v => v.y);
    let box = [Math.min(...xs) - 0.6, Math.min(...ys) - 0.6, Math.max(...xs) + 0.6, Math.max(...ys) + 0.6];
    const polys = board.hexes.map(h => hexCorners(h.x, h.y));
    const inHex = (x, y) => polys.some(pts => pts.every(([ax, ay], i) => { const [bx, by] = pts[(i + 1) % 6]; return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0; }));
    for (const [eid, type] of Object.entries(board.harbors)) {
      const edge = g.edges[eid], [a1, b1] = edge.v.map(i => g.vertices[i]), own = board.hexes[edge.hexes[0]];
      const mx = (a1.x + b1.x) / 2, my = (a1.y + b1.y) / 2, len = Math.hypot(mx - own.x, my - own.y) || 1, nx = (mx - own.x) / len, ny = (my - own.y) / len;
      const label = el('text', { class: 'harbor', x: mx, y: my }, type === '3:1' ? '3:1' : `2:1 ${type}`);
      layer.append(el('line', { class: 'harbor-line', x1: a1.x, y1: a1.y, x2: b1.x, y2: b1.y }), label);
      const w = (label.getComputedTextLength() || 0.12 * label.textContent.length) + 0.1, h = 0.26;
      let d = 0.1 + Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2, cx = mx, cy = my;
      for (let k = 0; k < 24; k++, d += 0.05) {
        cx = mx + nx * d; cy = my + ny * d;
        if (![[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].some(([sx, sy]) => inHex(cx + sx * w / 2, cy + sy * h / 2))) break;
      }
      label.setAttribute('x', cx); label.setAttribute('y', cy + 0.08);
      box = [Math.min(box[0], cx - w / 2 - 0.1), Math.min(box[1], cy - h / 2 - 0.1), Math.max(box[2], cx + w / 2 + 0.1), Math.max(box[3], cy + h / 2 + 0.1)];
    }
    svg.setAttribute('viewBox', `${box[0]} ${box[1]} ${box[2] - box[0]} ${box[3] - box[1]}`);
    // Placed pieces: a square for another player, a house for you; the number is the seat.
    for (const x of p.placed) {
      const v = g.vertices[x.corner - 1], mine = x.seat === p.seat;
      layer.append(mine ? el('path', { class: 'piece me', d: `M${v.x - 0.2},${v.y + 0.18} L${v.x - 0.2},${v.y - 0.05} L${v.x},${v.y - 0.24} L${v.x + 0.2},${v.y - 0.05} L${v.x + 0.2},${v.y + 0.18} Z` })
        : el('rect', { class: 'piece opp', x: v.x - 0.18, y: v.y - 0.18, width: 0.36, height: 0.36, rx: 0.05 }));
      layer.append(el('text', { class: 'piece-n' + (mine ? ' mine' : ''), x: v.x, y: v.y + 0.09 }, String(x.seat)));
    }
    // Open corners with their numbers, marked with this position's answers.
    for (const n of openCorners(p)) {
      const v = g.vertices[n - 1];
      const mark = a.choice === n ? ' choice' : a.plannedSecond === n ? ' second' : a.acceptable.includes(n) ? ' ok' : '';
      layer.append(el('g', { class: 'corner' + mark }, el('circle', { cx: v.x, cy: v.y, r: 0.19 }), el('text', { x: v.x, y: v.y + 0.065 }, String(n))));
    }
  }

  function options(select, corners, p, value, none) {
    select.replaceChildren(new Option(none, ''), ...corners.map(n => new Option(`${n}: ${describeCorner(p, n)}`, String(n))));
    select.value = value === null ? '' : String(value);
  }

  // Redraw everything for the current position except the free-text box, keeping keyboard focus where it was.
  function render() {
    const p = current(), a = answerFor(p), i = list.indexOf(p), focusId = document.activeElement?.id;
    $('#pos-title').textContent = `Position ${p.id} (${i + 1} of ${list.length})`;
    $('#task').textContent = taskText(p);
    $('#placed').replaceChildren(...(p.placed.length ? p.placed.map(x => Object.assign(document.createElement('li'),
      { textContent: `Seat ${x.seat}${x.seat === p.seat ? ' (you)' : ''}: corner ${x.corner} (${describeCorner(p, x.corner)})` })) : [Object.assign(document.createElement('li'), { textContent: 'Nothing yet.' })]));
    drawBoard(p, a);
    $('#choice-legend').textContent = `Your ${p.task} settlement`;
    options($('#choice'), openCorners(p), p, a.choice, 'Not chosen yet');
    const planning = !form && p.task === 'first';
    $('#second-box').hidden = !planning;
    $('[data-tap="second"]').hidden = !planning;
    if (!planning && tap === 'second') tap = 'choice';
    options($('#second'), a.choice === null ? [] : openCorners(p, [a.choice]), p, a.plannedSecond, a.choice === null ? 'Choose your first settlement first' : 'No plan');
    $('#second').disabled = a.choice === null;
    $('#alts').replaceChildren(...openCorners(p).filter(n => n !== a.choice).map(n => {
      const label = document.createElement('label'), box = Object.assign(document.createElement('input'), { type: 'checkbox', id: `alt-${n}`, value: String(n), checked: a.acceptable.includes(n) });
      label.title = describeCorner(p, n);
      label.append(box, ` ${n}`, Object.assign(document.createElement('span'), { className: 'sr', textContent: `: ${describeCorner(p, n)}` }));
      return label;
    }));
    for (const r of document.querySelectorAll('input[name="confidence"]')) r.checked = Number(r.value) === a.confidence;
    for (const b of document.querySelectorAll('[data-tap]')) b.setAttribute('aria-pressed', String(b.dataset.tap === tap));
    const answered = list.filter(x => cleanAnswer(x, state.answers[x.id]).choice !== null).length;
    $('#progress').textContent = `${answered} of ${list.length} answered`;
    $('#nav').replaceChildren(...list.map(x => {
      const done = cleanAnswer(x, state.answers[x.id]).choice !== null;
      const b = Object.assign(document.createElement('button'), { type: 'button', className: done ? 'done' : '', textContent: x.id });
      b.dataset.id = x.id;
      b.append(Object.assign(document.createElement('span'), { className: 'sr', textContent: done ? ', answered' : ', not answered' }));
      if (x.id === p.id) b.setAttribute('aria-current', 'step');
      const li = document.createElement('li'); li.append(b); return li;
    }));
    $('#prev').disabled = i === 0;
    $('#next').textContent = i === list.length - 1 ? 'Finish' : 'Next';
    if (focusId && document.activeElement?.id !== focusId) document.getElementById(focusId)?.focus();
  }

  function show(id, focus) {
    state.at = id;
    $('#why').value = answerFor(current()).reasoning;
    render(); save();
    if (focus) $('#pos-title').focus();
  }
  function update(change) {
    const p = current(), a = { ...answerFor(p), ...change };
    state.answers[p.id] = { ...cleanAnswer(p, a), reasoning: a.reasoning };
    changedSinceDownload = true;
    render(); save();
  }

  function tapCorner(n) {
    const a = answerFor(current());
    if (tap === 'choice') return update({ choice: a.choice === n ? null : n });
    if (tap === 'second') {
      if (a.choice === null) return say('Choose your first settlement before a planned second.');
      if (a.plannedSecond !== n && !openCorners(current(), [a.choice]).includes(n)) return say(`Corner ${n} is too close to your first settlement.`);
      return update({ plannedSecond: a.plannedSecond === n ? null : n });
    }
    if (n === a.choice) return say(`Corner ${n} is already your choice.`);
    update({ acceptable: a.acceptable.includes(n) ? a.acceptable.filter(x => x !== n) : [...a.acceptable, n] });
  }

  function download() {
    const file = answerFile({ code: state.code, answers: state.answers, form });
    if (!file.answers.length) return say('Nothing to download yet: choose a corner for at least one position.');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
    link.download = `catan-${form ? `test-form-${form}` : 'review'}-${state.code.replace(/[^A-Za-z0-9-]/g, '').slice(0, 20) || 'no-code'}-${file.exportedAt.slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    changedSinceDownload = false;
    say(`Downloaded ${file.answers.length} of ${list.length} positions. Send the file to the study team.`);
  }

  // Wire up the page.
  document.title = form ? `Catan opening test, form ${form}` : 'Catan opening review';
  $('#title').textContent = document.title;
  for (const x of document.querySelectorAll('[data-mode]')) x.hidden = x.dataset.mode !== (form ? 'test' : 'review');
  if (requested && !form) say(`There is no form "${requested}". Showing every position.`);
  $('#alt-box').hidden = $('#tap').hidden = $('#why-box').hidden = !!form;
  $('#code').value = state.code;
  $('#code').addEventListener('input', e => { state.code = e.target.value; changedSinceDownload = true; save(); });
  $('#why').addEventListener('input', e => { state.answers[state.at] = { ...answerFor(current()), reasoning: e.target.value }; changedSinceDownload = true; save(); });
  $('#choice').addEventListener('change', e => update({ choice: e.target.value ? Number(e.target.value) : null }));
  $('#second').addEventListener('change', e => update({ plannedSecond: e.target.value ? Number(e.target.value) : null }));
  $('#alts').addEventListener('change', e => {
    const n = Number(e.target.value), a = answerFor(current());
    update({ acceptable: e.target.checked ? [...a.acceptable, n] : a.acceptable.filter(x => x !== n) });
  });
  $('#confidence').addEventListener('change', e => update({ confidence: Number(e.target.value) }));
  $('#tap').addEventListener('click', e => { const b = e.target.closest('[data-tap]'); if (b) { tap = b.dataset.tap; render(); } });
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) show(b.dataset.id, true); });
  $('#prev').addEventListener('click', () => show(list[list.indexOf(current()) - 1].id, true));
  $('#next').addEventListener('click', () => {
    const i = list.indexOf(current());
    if (i < list.length - 1) return show(list[i + 1].id, true);
    $('#download').focus(); $('#download').scrollIntoView({ block: 'center' });
  });
  $('#download').addEventListener('click', download);
  $('#clear').addEventListener('click', () => {
    if (!confirm('Clear every answer on this device? Download them first if you still need them.')) return;
    try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
    state = { code: '', answers: {}, at: list[0].id };
    $('#code').value = '';
    show(list[0].id, true);
    say('All answers on this device were cleared.');
  });
  $('#board').addEventListener('click', e => {
    const m = $('#board').getScreenCTM();
    if (!m) return;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const id = nearestVertex(boardOf(current()).graph, point, Math.min(0.9, Math.max(0.3, 22 / Math.hypot(m.a, m.b))));
    if (id !== null && openCorners(current()).includes(id + 1)) tapCorner(id + 1);
  });
  addEventListener('beforeunload', e => { if (!stored && changedSinceDownload) e.preventDefault(); });
  $('#app').hidden = false;
  show(state.at, false);
}

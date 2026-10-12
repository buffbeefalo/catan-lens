// Look-ahead ranking: the experimental policy `draft-aware-2026-10-12` (rule R14 in docs/RESEARCH.md).
// The classic ranking (score.js) scores one corner at a time. This layer ranks your NEXT settlement by the
// opening it leads to. A first settlement is worth its own score plus the best second settlement the projected
// draft leaves you (source 8: "a spot which would guarantee a safe 2nd settlement pick"), and room to grow (R8)
// counts only a corner that is still open when setup ends. Every other seat is projected with the classic model,
// so this layer never calls itself. score.js is unchanged; the classic policy stays the baseline.
import { rankSpots, compare } from './score.js';
import { PIPS } from './board.js';
import { legalVertices } from './geometry.js';

export const POLICY = 'draft-aware-2026-10-12';

const order = n => [...Array.from({ length: n }, (_, i) => i + 1), ...Array.from({ length: n }, (_, i) => n - i)];
const pipsAt = (board, vid) => board.graph.vertices[vid].hexes.reduce((s, h) => s + (board.hexes[h].number ? PIPS[board.hexes[h].number] : 0), 0);
const list = arr => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
const cents = x => Math.round(x * 100);
const byRank = (a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id;
const better = (a, b) => byRank(a, b) < 0;
function describe(board, vid) {
  const prod = {};
  for (const h of board.graph.vertices[vid].hexes) { const x = board.hexes[h]; if (x.number) prod[x.resource] = (prod[x.resource] || 0) + PIPS[x.number]; }
  const pips = Object.values(prod).reduce((s, x) => s + x, 0);
  return `${pips === 8 || pips === 11 || pips === 18 ? 'an' : 'a'} ${pips}-pip corner (${list(Object.entries(prod).map(([r, p]) => `${p} ${r}`)) || 'no production'})`;
}

// Another seat's projected pick: the classic model with that seat's own plan. A plan the user chose for their
// own seat never carries over to the other seats.
const classicPick = (board, settings, seat, mine, occupied) =>
  rankSpots(board, { players: settings.players, seat, cak: settings.cak }, { mine, occupied, explain: false })[0] || null;

// The opening draft, with pieces already placed consumed in turn order exactly as score.js simulateDraft does:
// mine at my seat's slots, opponent marks at the other slots in mark order, everything placed counted as occupied
// from the start. `chooseMine(occupied, mine)` decides my unplaced picks; every other seat uses the classic model.
export function projectDraft(board, settings, { me = [], opp = [] } = {}, chooseMine = null) {
  const N = settings.players, S = settings.seat;
  const occupied = [...me, ...opp];
  const firsts = {};
  const out = [];
  let mi = 0, oi = 0;
  order(N).forEach((seat, slot) => {
    const round = slot < N ? 1 : 2;
    let id, actual = true, score = null;
    if (seat === S) { if (mi < me.length) id = me[mi++]; }
    else if (oi < opp.length) id = opp[oi++];
    if (id === undefined) {
      const mine = round === 2 && firsts[seat] !== undefined ? [firsts[seat]] : [];
      const pick = seat === S ? (chooseMine ? chooseMine([...occupied], mine) : rankSpots(board, settings, { mine, occupied, explain: false })[0])
        : classicPick(board, settings, seat, mine, occupied);
      if (!pick) return;
      id = pick.id; actual = false; score = pick.score; occupied.push(id);
    }
    if (round === 1) firsts[seat] = id;
    out.push({ seat, round, id, actual, you: seat === S, score });
  });
  return out;
}

// R8 room to grow, split in two: the classic target (the best corner exactly two roads away that is open once
// `vid` is taken) and the surviving target (the best such corner still open when the projected setup ends).
function roomToGrow(board, vid, occupied, endOccupied) {
  const g = board.graph;
  const now = new Set(legalVertices(g, [...occupied, vid]));
  const end = new Set(legalVertices(g, endOccupied));
  let classic = null, surviving = null;
  for (const n of g.vertices[vid].neighbors) for (const t of g.vertices[n].neighbors) {
    if (t === vid || !now.has(t)) continue;
    const p = pipsAt(board, t);
    if (!classic || p > classic.pips) classic = { id: t, pips: p };
    if (end.has(t) && (!surviving || p > surviving.pips)) surviving = { id: t, pips: p };
  }
  return { classic, surviving };
}

// Swap a scored corner's R8 term for the surviving version. R8 is 0.10 x the target's pips, so the change is an
// exact number of cents; every other part stays exactly as the classic scorer wrote it.
function withSurvivingRoom(board, scored, room, explain = true) {
  const value = room.surviving ? room.surviving.pips / 10 : 0;
  const score = (cents(scored.score) - 10 * (room.classic ? room.classic.pips : 0) + 10 * (room.surviving ? room.surviving.pips : 0)) / 100;
  const text = !explain ? false
    : room.surviving && room.surviving.pips >= 8 ? `Room to grow after setup: ${describe(board, room.surviving.id)} two roads away should still be open when setup ends.`
    : room.surviving ? `Room to grow after setup is thin: the best corner two roads away that should still be open when setup ends has only ${room.surviving.pips} pip${room.surviving.pips === 1 ? '' : 's'}.`
    : room.classic ? 'Room to grow: the corners two roads away are open now, but the projected setup takes or blocks every one of them, so this adds nothing.'
    : 'No open settlement site two roads away. Longer routes are not included in this expansion bonus.';
  return { ...scored, score, parts: scored.parts.map(p => (p.k === 'expansion' ? { k: 'expansion', v: value, text } : p)), room };
}

// My second settlement, look-ahead version: the classic second-settlement score with R8 counting only a corner
// the rest of the projected draft leaves open. `occupied` lists every settlement down at my second turn, real marks
// first and then projected picks in turn order. Exact pruning: survival can only lower R8, so once a corner's
// classic score falls below the best look-ahead score found, neither it nor any later corner can win.
export function rankSecond(board, settings, first, occupied, { all = false, explain = true } = {}) {
  const others = occupied.filter(x => x !== first);
  const out = [];
  let best = null;
  for (const c of rankSpots(board, settings, { mine: [first], occupied, explain })) {
    if (!all && best && c.score < best.score) break;
    const projection = projectDraft(board, settings, { me: [first, c.id], opp: others });
    const scored = { ...withSurvivingRoom(board, c, roomToGrow(board, c.id, occupied, projection.map(d => d.id)), explain), classicScore: c.score, projection };
    out.push(scored);
    if (!best || better(scored, best)) best = scored;
  }
  return out.sort(byRank);
}

// My first settlement, look-ahead version. For each open corner: place it, project the draft (other seats by the
// classic model, my second by rankSecond above), and value the opening as this corner (with surviving R8) plus my
// projected second. For the last seat the two picks are consecutive, so this is an exact choice of both corners.
export function rankFirst(board, settings, { opp = [] } = {}) {
  const out = [];
  for (const c of rankSpots(board, settings, { mine: [], occupied: opp })) {
    let second = null;
    const projection = projectDraft(board, settings, { me: [c.id], opp }, occupied => (second = rankSecond(board, settings, c.id, occupied, { explain: false })[0] || null));
    const own = withSurvivingRoom(board, c, roomToGrow(board, c.id, opp, projection.map(d => d.id)));
    const parts = [...own.parts];
    if (second) parts.push({ k: 'outlook', v: second.score, text: `Second settlement: the projected draft leaves you ${describe(board, second.id)}, worth ${second.score.toFixed(2)} as your second pick.` });
    else parts.push({ k: 'outlook', v: 0, text: 'Second settlement: the projected draft leaves no open corner for your second pick.' });
    out.push({ ...own, own: own.score, score: (cents(own.score) + cents(second ? second.score : 0)) / 100, classicScore: c.score, second, projection, parts });
  }
  return out.sort(byRank);
}

// The look-ahead ranking of my next settlement, given what is on the board. Same shape as score.js rankSpots, plus
// `own`, `second` and `projection` on first picks. Returns [] once both of my settlements are down. Results are
// remembered per board (the page redraws often; the answer for one position never changes) and must not be edited.
const MEMO = new WeakMap();
export function rankLookahead(board, settings, { me = [], opp = [] } = {}) {
  if (me.length >= 2) return [];
  let memo = MEMO.get(board);
  if (!memo) MEMO.set(board, memo = new Map());
  const key = JSON.stringify([settings.players, settings.seat, !!settings.cak, settings.plan ?? null, me, opp]);
  if (memo.has(key)) return memo.get(key);
  // Every open corner is valued (no pruning here), so any pick on screen can be graded against the same ranking.
  const ranking = me.length === 1 ? rankSecond(board, settings, me[0], [...me, ...opp], { all: true }) : rankFirst(board, settings, { opp });
  if (memo.size >= 64) memo.delete(memo.keys().next().value);   // keep the most recent positions only
  memo.set(key, ranking);
  return ranking;
}

// The projected opening if `id` becomes my next settlement: the same projection the look-ahead used to value it,
// so the road advice and the map badges always match the choice on screen.
export function projectionFor(board, settings, { me = [], opp = [] } = {}, id) {
  const ranked = rankLookahead(board, settings, { me, opp }).find(r => r.id === id);
  if (ranked?.projection) return ranked.projection;
  if (me.length === 0) return projectDraft(board, settings, { me: [id], opp }, occupied => rankSecond(board, settings, id, occupied, { explain: false })[0] || null);
  return projectDraft(board, settings, { me: [...me, id], opp });
}

// Explain why a higher-ranked look-ahead choice beats a pick: the second-settlement outlook first, then the
// classic explanation of the corners themselves.
export function compareLookahead(best, pick) {
  if (best.id === pick.id || best.score <= pick.score) return [];
  const out = [];
  const outlook = r => r.parts.find(p => p.k === 'outlook');
  const b = outlook(best), p = outlook(pick);
  if (b && p && b.v - p.v >= 0.01) out.push(`Second-settlement outlook: ${b.v.toFixed(2)} for #1 versus ${p.v.toFixed(2)} for your pick.`);
  const own = r => ({ ...r, score: r.own ?? r.score, parts: r.parts.filter(x => x.k !== 'outlook') });
  return [...out, ...compare(own(best), own(pick))];
}

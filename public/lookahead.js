// Look-ahead ranking: the experimental policy `draft-aware-2026-10-12` (rule R14 in docs/RESEARCH.md).
// The classic ranking (score.js) scores one corner at a time. This layer ranks your next settlement for your turn,
// by the opening it leads to. Every seat that picks before your turn and has not placed is projected first. A first
// settlement is valued together with the best second settlement the projected draft leaves you (source 8: "a spot
// which would guarantee a safe 2nd settlement pick"), and that second is the one that makes the whole opening best.
// Each settlement keeps its classic score, except that its harbour (R7) and room-to-grow (R8) credits count only a
// spot still open when the projected setup ends, and a corner or harbour type both settlements could use counts once.
// Other seats are projected with the classic model and never look ahead, so this layer never calls itself; the
// classic policy in score.js is unchanged and stays the baseline.
import { rankSpots, scoreVertex, compare, PLANS, planFor, PORT, EXPANSION } from './score.js';
import { PIPS } from './board.js';
import { legalVertices } from './geometry.js';

export const POLICY = 'draft-aware-2026-10-12';

const order = n => [...Array.from({ length: n }, (_, i) => i + 1), ...Array.from({ length: n }, (_, i) => n - i)];
const pipsAt = (board, vid) => board.graph.vertices[vid].hexes.reduce((s, h) => s + (board.hexes[h].number ? PIPS[board.hexes[h].number] : 0), 0);
const list = arr => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
// Cents exactly as score.js rounds a displayed value (a half cent lost to binary arithmetic still rounds up).
function cents(x) {
  const c = x * 100, half = Math.floor(c) + 0.5;
  return Math.round(Math.abs(c - half) <= 8 * Number.EPSILON * Math.max(1, Math.abs(c)) ? half : c);
}
const byRank = (a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id;
function production(board, ids) {
  const prod = {};
  for (const v of ids) for (const h of board.graph.vertices[v].hexes) { const x = board.hexes[h]; if (x.number) prod[x.resource] = (prod[x.resource] || 0) + PIPS[x.number]; }
  return prod;
}
function describe(board, vid) {
  const prod = production(board, [vid]), pips = Object.values(prod).reduce((s, x) => s + x, 0);
  return `${pips === 8 || pips === 11 || pips === 18 ? 'an' : 'a'} ${pips}-pip corner (${list(Object.entries(prod).map(([r, p]) => `${p} ${r}`)) || 'no production'})`;
}
const portsAt = (board, vid) => board.graph.vertices[vid].edges.filter(e => board.harbors[e] !== undefined).map(e => board.harbors[e]);
const portName = t => (t === '3:1' ? 'the 3:1 port' : `the 2:1 ${t} port`);

// ---- Other seats ----------------------------------------------------------------------------------------------

// The classic top corner, exactly rankSpots(...)[0] but faster. A corner's score with nothing else on the board is an
// upper bound on its score now (more pieces only take harbour and room-to-grow targets away), so corners are scored
// in order of that bound and the search stops once no remaining bound can reach the best score found.
const BOUNDS = new WeakMap();
function topSpot(board, settings, mine, occupied) {
  let memo = BOUNDS.get(board);
  if (!memo) BOUNDS.set(board, memo = new Map());
  const key = `${settings.players}|${settings.seat}|${!!settings.cak}|${settings.plan ?? ''}|${mine.join(',')}`;
  let byBound = memo.get(key);
  if (!byBound) {
    byBound = board.graph.vertices.map(v => { const s = scoreVertex(board, settings, v.id, { mine, occupied: [], explain: false }); return { id: v.id, bound: s.score, pips: s.pips }; })
      .sort((a, b) => b.bound - a.bound || b.pips - a.pips || a.id - b.id);
    memo.set(key, byBound);
  }
  const legal = new Set(legalVertices(board.graph, occupied));
  let best = null;
  for (const o of byBound) {
    if (best && o.bound < best.score) break;
    if (!legal.has(o.id)) continue;
    const s = scoreVertex(board, settings, o.id, { mine, occupied, explain: false });
    if (!best || s.score > best.score || (s.score === best.score && (s.pips > best.pips || (s.pips === best.pips && s.id < best.id)))) best = s;
  }
  return best;
}

// Another seat's projected pick: the classic model with that seat's own plan. A plan the user chose for their own
// seat never carries over to the other seats.
const classicPick = (board, settings, seat, mine, occupied) => topSpot(board, { players: settings.players, seat, cak: settings.cak }, mine, occupied);

// Report-only opponent styles for a stability check. They change how the other seats are imagined to pick and never
// feed the look-ahead's own ranking, which always projects them with the classic model.
const bestBy = (board, occupied, key) => legalVertices(board.graph, occupied).reduce((a, v) => {
  const k = key(v);
  return !a || k[0] > a.k[0] || (k[0] === a.k[0] && (k[1] > a.k[1] || (k[1] === a.k[1] && v < a.id))) ? { id: v, k } : a;
}, null);
const STYLES = {
  classic: classicPick,
  // The open corner with the most pips.
  pips: (board, settings, seat, mine, occupied) => { const b = bestBy(board, occupied, v => [pipsAt(board, v), 0]); return b && { id: b.id, score: null }; },
  // The open corner that adds the most resources the seat does not produce yet, then the most pips.
  coverage: (board, settings, seat, mine, occupied) => {
    const have = production(board, mine);
    const b = bestBy(board, occupied, v => [Object.keys(production(board, [v])).filter(r => !have[r]).length, pipsAt(board, v)]);
    return b && { id: b.id, score: null };
  },
};
export const OPPONENT_STYLES = ['pips', 'coverage'];

// The opening draft, with pieces already placed consumed in turn order exactly as score.js simulateDraft does:
// mine at my seat's slots, opponent marks at the other slots in mark order, everything placed counted as occupied
// from the start. `chooseMine(occupied, mine)` decides my unplaced picks; the other seats pick in `style`. `real`
// (a Set) says which placed pieces are really on the board: a candidate being valued is placed but not actual.
export function projectDraft(board, settings, { me = [], opp = [] } = {}, chooseMine = null, style = 'classic', real = null) {
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
      const pick = seat === S ? (chooseMine ? chooseMine([...occupied], mine) : topSpot(board, settings, mine, occupied))
        : STYLES[style](board, settings, seat, mine, occupied);
      if (!pick) return;
      id = pick.id; actual = false; score = pick.score; occupied.push(id);
    } else if (real) actual = real.has(id);
    if (round === 1) firsts[seat] = id;
    out.push({ seat, round, id, actual, you: seat === S, score });
  });
  return out;
}

// The picks the seats before my next turn would make if they have not placed yet, in turn order.
function aheadOfMe(board, settings, { me, opp }, style) {
  const N = settings.players, S = settings.seat, occupied = [...me, ...opp], firsts = {}, out = [];
  let mi = 0, oi = 0;
  for (const [slot, seat] of order(N).entries()) {
    const round = slot < N ? 1 : 2;
    let id;
    if (seat === S) {
      if (mi >= me.length) break;   // my next turn
      id = me[mi++];
    } else if (oi < opp.length) id = opp[oi++];
    else {
      const pick = STYLES[style](board, settings, seat, round === 2 && firsts[seat] !== undefined ? [firsts[seat]] : [], occupied);
      if (!pick) continue;
      id = pick.id; occupied.push(id); out.push(id);
    }
    if (round === 1) firsts[seat] = id;
  }
  return out;
}

// ---- One settlement's harbour and room to grow, judged at the end of setup ----------------------------------------

// R8: the best settlement site exactly two roads from `vid` that is open in `open`, skipping `skip`. Ties keep the
// first found, in the same order as score.js, so with the classic `open` this is the classic target.
function growth(board, vid, open, skip = null) {
  let best = null;
  for (const n of board.graph.vertices[vid].neighbors) for (const t of board.graph.vertices[n].neighbors) {
    if (t === vid || t === skip || !open.has(t)) continue;
    const p = pipsAt(board, t);
    if (!best || p > best.pips) best = { id: t, pips: p };
  }
  return best;
}

// R7: a harbour on the corner, else the best one at a settlement site two roads away that is open in `open` (half
// value). Types `mine` already owns, and `skip`, earn nothing. With the classic `open` this is the classic credit.
function harbour(board, settings, vid, mine, open, skip = null) {
  const mul = PLANS[planFor(settings)].portMul, fed = production(board, [vid, ...mine]);
  const owned = new Set(mine.flatMap(m => portsAt(board, m)));
  const value = (t, m) => (t === '3:1' ? PORT.generic * m : (fed[t] || 0) >= PORT.matchPips ? PORT.matched * m : PORT.unmatched * m);
  let port = null;
  for (const t of portsAt(board, vid)) {
    if (owned.has(t) || t === skip) continue;
    const v = value(t, mul);
    if (!port || v > port.v) port = { type: t, v, far: false, fed: fed[t] || 0 };
  }
  if (!port) for (const n of board.graph.vertices[vid].neighbors) for (const site of board.graph.vertices[n].neighbors) {
    if (!open.has(site)) continue;
    for (const t of portsAt(board, site)) {
      if (owned.has(t) || t === skip) continue;
      const v = value(t, mul * PORT.farMul);
      if (!port || v > port.v) port = { type: t, v, far: true, fed: fed[t] || 0 };
    }
  }
  return port;
}

const centsOf = x => (!x ? 0 : cents(x.v !== undefined ? x.v : x.pips * EXPANSION));
// A corner's classic score, in cents, without its R7 and R8 parts as displayed: what the opening judges again. It is
// computed once per corner and holdings, with nothing else on the board, so it never moves by a rounding cent.
const core = scored => cents(scored.score) - ['port', 'expansion'].reduce((sum, k) => sum + cents(scored.parts.find(p => p.k === k)?.v || 0), 0);
const coreParts = scored => scored.parts.filter(p => p.k !== 'port' && p.k !== 'expansion');
const CORES = new WeakMap();
function coreOf(board, settings, vid, mine) {
  let memo = CORES.get(board);
  if (!memo) CORES.set(board, memo = new Map());
  const key = `${settings.players}|${settings.seat}|${!!settings.cak}|${settings.plan ?? ''}|${vid}|${mine.join(',')}`;
  if (!memo.has(key)) memo.set(key, core(scoreVertex(board, settings, vid, { mine, occupied: [], explain: false })));
  return memo.get(key);
}

// Both settlements' R7 and R8 at the end of setup (`end` lists every settlement then), each spot credited once: when
// both settlements' best target is the same corner (or the same harbour type), the split worth more overall keeps it
// and the other settlement takes its next best. `now` (open when the pick is made) only words the sentences.
function settle(board, settings, f, s, end, now) {
  const open = new Set(legalVertices(board.graph, end)), shared = { growth: null, port: null };
  let g = [growth(board, f, open), growth(board, s, open)];
  if (g[0] && g[1] && g[0].id === g[1].id) {
    const a = [g[0], growth(board, s, open, g[0].id)], b = [growth(board, f, open, g[1].id), g[1]];
    const keeper = centsOf(a[0]) + centsOf(a[1]) >= centsOf(b[0]) + centsOf(b[1]) ? 0 : 1;
    shared.growth = { id: g[0].id, keeper };
    g = keeper === 0 ? a : b;
  }
  let h = [harbour(board, settings, f, [], open), harbour(board, settings, s, [f], open)];
  if (h[0] && h[1] && h[0].type === h[1].type) {
    const a = [h[0], harbour(board, settings, s, [f], open, h[0].type)], b = [harbour(board, settings, f, [], open, h[1].type), h[1]];
    const keeper = centsOf(a[0]) + centsOf(a[1]) >= centsOf(b[0]) + centsOf(b[1]) ? 0 : 1;
    shared.port = { type: h[0].type, keeper };
    h = keeper === 0 ? a : b;
  }
  return { pair: [f, s], g, h, shared, now };
}

function growthText(board, i, sett) {
  const t = sett.g[i], other = i === 0 ? 'your second settlement' : 'your first settlement';
  const shared = sett.shared.growth && sett.shared.growth.keeper !== i ? ` The corner both settlements could grow to, ${describe(board, sett.shared.growth.id)}, counts once, for ${other}.` : '';
  if (t && t.pips >= 8) return `Room to grow after setup: ${describe(board, t.id)} two roads away should still be open when setup ends.${shared}`;
  if (t) return `Room to grow after setup is thin: the best corner two roads away that should still be open when setup ends has only ${t.pips} pip${t.pips === 1 ? '' : 's'}.${shared}`;
  if (shared) return `No other settlement site two roads away stays open through setup.${shared}`;
  return growth(board, sett.pair[i], sett.now) ? 'Room to grow: the corners two roads away are open now, but the projected setup takes or blocks every one of them, so this adds nothing.'
    : 'No open settlement site two roads away. Longer routes are not included in this expansion bonus.';
}

function harbourText(board, settings, i, sett) {
  const p = sett.h[i], other = i === 0 ? 'your second settlement' : 'your first settlement', mine = i === 0 ? [] : [sett.pair[0]];
  const name = sett.shared.port && portName(sett.shared.port.type);
  const shared = sett.shared.port && sett.shared.port.keeper !== i ? ` ${name[0].toUpperCase()}${name.slice(1)} counts once, for ${other}.` : '';
  if (!p) {
    if (shared) return shared.trim();
    return harbour(board, settings, sett.pair[i], mine, sett.now) ? 'A port two roads away is open now, but the projected setup takes or blocks its settlement site, so it adds nothing.' : null;
  }
  const where = p.far ? 'Two roads and a new settlement would reach' : 'Sits on', still = p.far ? ', still open when setup ends' : '';
  if (p.type === '3:1') return `${where} the 3:1 port${still}: the flexible port top players value most.${shared}`;
  return p.fed >= PORT.matchPips ? `${where} the 2:1 ${p.type} port${still}, with ${p.fed} pips of ${p.type} to feed it.${shared}`
    : `${where} the 2:1 ${p.type} port${still}, but with only ${p.fed} pips of ${p.type} it will rarely be used.${shared}`;
}

// One settlement's look-ahead value in cents (`i` 0 = first, 1 = second), with its R7 and R8 parts explained.
function judged(board, settings, coreCents, scored, i, sett, explain = true) {
  const parts = coreParts(scored);
  const port = explain ? harbourText(board, settings, i, sett) : (sett.h[i] ? false : null);
  if (port !== null) parts.push({ k: 'port', v: centsOf(sett.h[i]) / 100, text: port });
  parts.push({ k: 'expansion', v: centsOf(sett.g[i]) / 100, text: explain && growthText(board, i, sett) });
  return { cents: coreCents + centsOf(sett.h[i]) + centsOf(sett.g[i]), parts };
}

// ---- Ranking ----------------------------------------------------------------------------------------------------

// My second settlement: every corner open at my second turn, valued as the whole opening it completes with `first`.
// `occupied` lists every settlement down at that turn (real marks first, then projected picks in turn order). Exact
// pruning: survival and credit-once only ever lower a credit, so a corner whose opening value with everything still
// open is below the best opening found cannot win. `all` values every corner.
export function rankSecond(board, settings, first, occupied, { all = false, explain = true, style = 'classic', real = null } = {}) {
  const others = occupied.filter(x => x !== first);
  const firstCore = coreOf(board, settings, first, []);
  const candidates = rankSpots(board, settings, { mine: [first], occupied, explain }).map(c => {
    const now = new Set(legalVertices(board.graph, [...occupied, c.id])), secondCore = coreOf(board, settings, c.id, [first]);
    const bound = firstCore + centsOf(harbour(board, settings, first, [], now)) + centsOf(growth(board, first, now))
      + secondCore + centsOf(harbour(board, settings, c.id, [first], now)) + centsOf(growth(board, c.id, now));
    return { c, now, secondCore, bound };
  }).sort((a, b) => b.bound - a.bound || b.c.pips - a.c.pips || a.c.id - b.c.id);
  const out = [];
  let best = null;
  for (const { c, now, secondCore, bound } of candidates) {
    if (!all && best && bound < cents(best.score)) break;
    const projection = projectDraft(board, settings, { me: [first, c.id], opp: others }, null, style, real);
    const sett = settle(board, settings, first, c.id, projection.map(d => d.id), now);
    const one = judged(board, settings, firstCore, { parts: [] }, 0, sett, false), two = judged(board, settings, secondCore, c, 1, sett, explain);
    const parts = [...two.parts, { k: 'first', v: one.cents / 100, text: explain && `Your first settlement, ${describe(board, first)}, adds ${(one.cents / 100).toFixed(2)} to this opening.` }];
    // My unplaced settlements show their own look-ahead values in the projection.
    const shown = projection.map(d => (d.you && !d.actual ? { ...d, score: (d.id === c.id ? two.cents : one.cents) / 100 } : d));
    const entry = { ...c, score: (one.cents + two.cents) / 100, own: two.cents / 100, first: { id: first, score: one.cents / 100 }, classicScore: c.score, projection: shown, parts };
    out.push(entry);
    if (!best || byRank(entry, best) < 0) best = entry;
  }
  return out.sort(byRank);
}

// My first settlement: for each corner open at my turn, project the draft to my second turn (the other seats by the
// classic model), choose the second that makes the best opening, finish the draft, and value the whole opening. For
// the last seat the two picks are consecutive, so this is an exact choice of both corners.
export function rankFirst(board, settings, { opp = [], style = 'classic', real = null } = {}) {
  const out = [];
  for (const c of rankSpots(board, settings, { mine: [], occupied: opp })) {
    let second = null;
    const projection = projectDraft(board, settings, { me: [c.id], opp }, occupied => (second = rankSecond(board, settings, c.id, occupied, { explain: false, style, real })[0] || null), style, real);
    if (!second) {
      out.push({ ...c, own: c.score, second: null, classicScore: c.score, projection, parts: [...c.parts, { k: 'outlook', v: 0, text: 'Second settlement: the projected draft leaves no open corner for your second pick.' }] });
      continue;
    }
    // Explain this corner as the opening judged it: its harbour and room to grow at the end of setup.
    const sett = settle(board, settings, c.id, second.id, projection.map(d => d.id), new Set(legalVertices(board.graph, [...opp, c.id])));
    const one = judged(board, settings, coreOf(board, settings, c.id, []), c, 0, sett);
    const parts = [...one.parts, { k: 'outlook', v: second.own, text: `Second settlement: the projected draft leaves you ${describe(board, second.id)}, worth ${second.own.toFixed(2)} as your second pick.` }];
    const shown = projection.map(d => (d.you && !d.actual ? { ...d, score: d.id === c.id ? second.first.score : second.own } : d));
    out.push({ ...c, score: second.score, own: second.first.score, second: { id: second.id, score: second.own }, classicScore: c.score, projection: shown, parts });
  }
  return out.sort(byRank);
}

// The look-ahead ranking of my next settlement for my turn: seats before it that have not placed are projected
// first. Same shape as score.js rankSpots, plus `own`, `projection` and either `second` (first picks) or `first`
// (second picks). Returns [] once both of my settlements are down. Remembered per board (the page redraws often; the
// answer for one position never changes); the results must not be edited.
const MEMO = new WeakMap();
export function rankLookahead(board, settings, { me = [], opp = [] } = {}, { style = 'classic' } = {}) {
  if (me.length >= 2) return [];
  if (!Object.prototype.hasOwnProperty.call(STYLES, style)) throw new Error(`Unknown opponent style "${style}"`);
  let memo = MEMO.get(board);
  if (!memo) MEMO.set(board, memo = new Map());
  const key = JSON.stringify([settings.players, settings.seat, !!settings.cak, settings.plan ?? null, me, opp, style]);
  if (memo.has(key)) return memo.get(key);
  const real = new Set([...me, ...opp]), ahead = aheadOfMe(board, settings, { me, opp }, style);
  // Every corner open at my turn is valued (no pruning here), so any pick on screen can be graded the same way.
  const ranking = me.length === 1 ? rankSecond(board, settings, me[0], [...me, ...opp, ...ahead], { all: true, style, real })
    : rankFirst(board, settings, { opp: [...opp, ...ahead], style, real });
  if (memo.size >= 96) memo.delete(memo.keys().next().value);   // keep the most recent positions only
  memo.set(key, ranking);
  return ranking;
}

// The projected opening if `id` becomes my next settlement: the projection the look-ahead valued it with, so the road
// advice and the map badges match the choice on screen. A corner open now that the projection gives to another seat
// before my turn is not ranked; for it, the projection treats it as placed now.
export function projectionFor(board, settings, { me = [], opp = [] } = {}, id) {
  const ranked = rankLookahead(board, settings, { me, opp }).find(r => r.id === id);
  if (ranked) return ranked.projection;
  return projectDraft(board, settings, { me: [...me, id], opp }, null, 'classic', new Set([...me, ...opp]));
}

// Explain why a higher-ranked look-ahead choice beats a pick: the second-settlement outlook (first picks) or the
// first settlement's share (second picks) first, then the classic explanation of the corners themselves.
export function compareLookahead(best, pick) {
  if (best.id === pick.id || best.score <= pick.score) return [];
  const out = [];
  if (best.second && pick.second && best.second.score - pick.second.score >= 0.01) out.push(`Second-settlement outlook: ${best.second.score.toFixed(2)} for #1 versus ${pick.second.score.toFixed(2)} for your pick.`);
  if (best.first && pick.first && best.first.score - pick.first.score >= 0.01) out.push(`Your first settlement adds ${best.first.score.toFixed(2)} with #1 versus ${pick.first.score.toFixed(2)} with your pick, because its room to grow or harbour depends on the second.`);
  const own = r => ({ ...r, score: r.own ?? r.score, parts: r.parts.filter(x => x.k !== 'outlook' && x.k !== 'first') });
  return [...out, ...compare(own(best), own(pick))];
}

// Report-only stability check for a recommendation: rank the same position again with the other seats picking in each
// alternative style, and say where `id` lands. Nothing here changes the look-ahead's own ranking.
export function stability(board, settings, { me = [], opp = [] } = {}, id) {
  return OPPONENT_STYLES.map(style => {
    const ranking = rankLookahead(board, settings, { me, opp }, { style }), mine = ranking.find(r => r.id === id);
    return { style, top: ranking[0] || null, rank: mine ? 1 + ranking.filter(r => r.score > mine.score).length : null, total: ranking.length };
  });
}

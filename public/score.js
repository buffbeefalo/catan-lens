// Placement scoring. Every term maps to a rule in docs/RESEARCH.md (R1..R12); the `parts`
// array carries the plain-English reason for each term so the UI never invents a sentence.
import { PIPS, RESOURCES, SETUPS } from './board.js';
import { legalVertices } from './geometry.js';

export const PLANS = {
  // R2 / R10: seats 1-2 chase wheat+ore (Ore-Wheat-Sheep); later seats lean wood/brick + ports.
  ows:  { label: 'Ore–Wheat–Sheep plan', weights: { wheat: 1.15, ore: 1.15, wood: 1.0, brick: 1.0, sheep: 0.9 }, portMul: 1, lowTokenMul: 1, commodity: 0 },
  road: { label: 'Road-builder plan',    weights: { wood: 1.15, brick: 1.15, wheat: 1.0, ore: 0.95, sheep: 0.9 }, portMul: 1.5, lowTokenMul: 1, commodity: 0 },
  // R11: Cities & Knights re-values everything around ore, knights and commodities.
  cak:  { label: 'Cities & Knights plan', weights: { ore: 1.35, wheat: 1.15, wood: 1.1, sheep: 1.0, brick: 0.8 }, portMul: 0.5, lowTokenMul: 0.75, commodity: 0.5 },
};
const COMMODITY_HEXES = new Set(['wood', 'sheep', 'ore']);
const PAIR_BONUS = { woodbrick: 0.6, wheatore: 0.9 };   // R4 (scaled by the weaker half, full at 3+ pips)
const REPEAT_PENALTY = 0.75;                            // R6
const PORT = { generic: 1.0, matched: 1.5, unmatched: 0.25, matchPips: 5, farMul: 0.5 }; // R7
const EXPANSION = 0.10;                                 // R8
const COMPLEMENT = { any: 1.0, key: 1.5 };              // R9

export function planFor(settings) {
  if (settings.cak) return 'cak';
  return settings.seat <= Math.ceil(settings.players / 2) ? 'ows' : 'road';
}

// Board-wide facts used by the scarcity rule (R3) and by the explanations.
export function boardFacts(board) {
  const pips = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  const marquee = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const h of board.hexes) {
    if (!h.number) continue;
    pips[h.resource] += PIPS[h.number];
    if ([5, 6, 8, 9].includes(h.number)) marquee[h.resource]++;
  }
  const total = Object.values(pips).reduce((s, x) => s + x, 0);
  const tiles = SETUPS[board.setup].tiles;
  const land = RESOURCES.reduce((s, r) => s + tiles[r], 0);
  const scarcity = {};
  for (const r of RESOURCES) {
    const expected = tiles[r] / land, actual = pips[r] / total;
    scarcity[r] = actual === 0 ? 1.25 : Math.min(1.25, Math.max(0.8, expected / actual));
  }
  return { pips, marquee, total, scarcity };
}

function vertexProduction(board, vid) {
  const prod = {};
  const numbers = [];
  for (const hid of board.graph.vertices[vid].hexes) {
    const h = board.hexes[hid];
    if (!h.number) continue;
    prod[h.resource] = (prod[h.resource] || 0) + PIPS[h.number];
    numbers.push(h.number);
  }
  return { prod, numbers, pips: Object.values(prod).reduce((s, x) => s + x, 0) };
}

function portsAt(board, vid) {
  const v = board.graph.vertices[vid];
  return v.edges.filter(e => board.harbors[e] !== undefined).map(e => board.harbors[e]);
}

const NAMES = { wood: 'wood', brick: 'brick', wheat: 'wheat', sheep: 'sheep', ore: 'ore' };
const list = arr => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Score one corner. `mine` = my settlements already on the board; `occupied` = every settlement.
export function scoreVertex(board, settings, vid, { mine = [], occupied = [], facts = boardFacts(board), maxPips = 0 } = {}) {
  const plan = PLANS[planFor(settings)];
  const { prod, numbers, pips } = vertexProduction(board, vid);
  const parts = [];
  const resources = Object.keys(prod);

  // R1 + R2 + R3 (+ R11 low-token discount)
  let base = 0;
  for (const hid of board.graph.vertices[vid].hexes) {
    const h = board.hexes[hid];
    if (!h.number) continue;
    const p = PIPS[h.number];
    base += p * plan.weights[h.resource] * facts.scarcity[h.resource] * (p <= 2 ? plan.lowTokenMul : 1);
  }
  const rank = pips >= maxPips ? 'the most on the board' : pips >= maxPips - 1 ? 'within a pip of the best corner' : pips >= 10 ? 'a strong corner' : pips >= 8 ? 'a fair corner' : 'thin production';
  parts.push({ k: 'production', v: round(base), text: `${pips} pips of production — ${rank}: ${list(Object.entries(prod).map(([r, p]) => `${p} ${NAMES[r]}`))}.` });
  const scarce = resources.filter(r => facts.scarcity[r] >= 1.15 && prod[r] >= 3);
  if (scarce.length) parts.push({ k: 'scarcity', v: null, text: `${cap(list(scarce.map(r => NAMES[r])))} ${scarce.length > 1 ? 'are' : 'is'} scarce on this board (${list(scarce.map(r => `${facts.pips[r]} pips of ${NAMES[r]} anywhere`))}), so this corner's share is worth a trading premium.` });
  const plentiful = resources.filter(r => facts.scarcity[r] <= 0.85 && prod[r] >= 3);
  if (plentiful.length) parts.push({ k: 'plenty', v: null, text: `${cap(list(plentiful.map(r => NAMES[r])))} ${plentiful.length > 1 ? 'are' : 'is'} plentiful on this board, so it trades cheaply — counted at a discount.` });

  // R4 complementary pairs
  let pair = 0;
  const pairScale = (a, b) => Math.min(1, Math.min(prod[a] || 0, prod[b] || 0) / 3);
  if (prod.wood && prod.brick) { const v = round(PAIR_BONUS.woodbrick * pairScale('wood', 'brick')); pair += v; parts.push({ k: 'pair', v, text: 'Wood and brick together — every roll of either number moves you toward a road.' }); }
  if (prod.wheat && prod.ore) { const v = round(PAIR_BONUS.wheatore * pairScale('wheat', 'ore')); pair += v; parts.push({ k: 'pair', v, text: 'Wheat and ore together — the city-building pair, and two thirds of a development card.' }); }

  // R6 number repeats: a number of THIS corner that I already hold, or that appears twice on this corner.
  // (A duplicate inside my first settlement alone is not this corner's fault and is not charged here.)
  const held = new Set(mine.flatMap(m => vertexProduction(board, m).numbers));
  const seenHere = new Set(), repeated = [];
  for (const n of numbers) { if (held.has(n) || seenHere.has(n)) repeated.push(n); seenHere.add(n); }
  const repeats = repeated.length;
  const repeatPen = repeats * REPEAT_PENALTY;
  if (repeats) parts.push({ k: 'repeat', v: -repeatPen, text: `Repeats ${list([...new Set(repeated)].map(String))} — doubling up means feast-or-famine rolls and more 7-discards. A nudge, not a veto.` });

  // R7 ports (on the corner, or one road away at half value)
  const minePips = mine.reduce((acc, m) => { const p = vertexProduction(board, m).prod; for (const r in p) acc[r] = (acc[r] || 0) + p[r]; return acc; }, {});
  const portValue = (type, mul, where) => {
    if (type === '3:1') return { v: PORT.generic * mul, text: `${where} the 3:1 port — the flexible port top players value most.` };
    const have = (prod[type] || 0) + (minePips[type] || 0);
    if (have >= PORT.matchPips) return { v: PORT.matched * mul, text: `${where} the 2:1 ${NAMES[type]} port with ${have} pips of ${NAMES[type]} to feed it — a private trading post that never says no.` };
    return { v: PORT.unmatched * mul, text: `${where} the 2:1 ${NAMES[type]} port, but with only ${have} pips of ${NAMES[type]} it will rarely be used.` };
  };
  const v = board.graph.vertices[vid];
  const after = new Set(legalVertices(board.graph, [...occupied, vid]));   // corners still open once this one is taken
  let port = null;
  for (const t of portsAt(board, vid)) { const c = portValue(t, plan.portMul, 'Sits on'); if (!port || c.v > port.v) port = c; }
  if (!port) for (const n of v.neighbors) for (const e of board.graph.vertices[n].edges) {
    const t = board.harbors[e]; if (t === undefined) continue;
    const far = board.graph.edges[e].v.find(x => x !== n);   // the port edge's other end: the only corner you could still settle on
    if (far === undefined || far === vid || !after.has(far)) continue;
    const c = portValue(t, plan.portMul * PORT.farMul, 'One road from'); if (!port || c.v > port.v) port = c;
  }
  if (port) parts.push({ k: 'port', v: round(port.v), text: port.text });

  // R8 expansion room: best legal corner exactly two roads away once this one is taken.
  let best = null;
  for (const n of v.neighbors) for (const nn of board.graph.vertices[n].neighbors) {
    if (nn === vid || !after.has(nn)) continue;
    const p = vertexProduction(board, nn);
    if (!best || p.pips > best.pips) best = { id: nn, ...p };
  }
  const expansion = best ? best.pips * EXPANSION : 0;
  if (best && best.pips >= 8) parts.push({ k: 'expansion', v: round(expansion), text: `Room to grow: ${best.pips === 8 || best.pips === 11 || best.pips === 18 ? 'an' : 'a'} ${best.pips}-pip corner (${list(Object.entries(best.prod).map(([r, p]) => `${p} ${NAMES[r]}`))}) sits two roads away.` });
  else if (best) parts.push({ k: 'expansion', v: round(expansion), text: `Room to grow is thin: the best open corner two roads away has only ${best.pips} pip${best.pips === 1 ? '' : 's'}.` });
  else parts.push({ k: 'expansion', v: 0, text: 'Boxed in: no open corner two roads away — a dead end.' });

  // R9 second-settlement complement
  let complement = 0;
  if (mine.length) {
    const missing = RESOURCES.filter(r => !minePips[r]);
    const covers = resources.filter(r => missing.includes(r));
    for (const r of covers) complement += (r === 'wheat' || r === 'ore') ? COMPLEMENT.key : COMPLEMENT.any;
    if (covers.length) parts.push({ k: 'complement', v: round(complement), text: `Patches your first settlement: adds ${list(covers.map(r => NAMES[r]))}${covers.some(r => r === 'wheat' || r === 'ore') ? ' — the wheat/ore you need for cities' : ''}.` });
    const stillMissing = missing.filter(r => !covers.includes(r));
    if (stillMissing.length) parts.push({ k: 'gap', v: null, text: `You would still have no ${list(stillMissing.map(r => NAMES[r]))}.` });
  }

  // R11 commodity hexes (C&K only)
  let commodity = 0;
  if (plan.commodity) {
    const c = v.hexes.map(h => board.hexes[h]).filter(h => h.number && COMMODITY_HEXES.has(h.resource));
    commodity = c.length * plan.commodity;
    if (c.length) parts.push({ k: 'commodity', v: commodity, text: `${c.length} commodity hex${c.length > 1 ? 'es' : ''} (${list(c.map(h => NAMES[h.resource]))}) — a city here also produces ${list(c.map(h => ({ wood: 'paper', sheep: 'cloth', ore: 'coin' })[h.resource]))}.` });
  }

  const score = round(base + pair - repeatPen + (port ? port.v : 0) + expansion + complement + commodity);
  const cards = {};
  for (const hid of v.hexes) { const h = board.hexes[hid]; if (h.number) cards[h.resource] = (cards[h.resource] || 0) + 1; }
  const startingCards = mine.length ? Object.entries(cards).map(([r, c]) => `${c} ${NAMES[r]}`) : [];   // R9: one card per adjacent hex
  return { id: vid, score, pips, prod, numbers, resources, parts, plan: planFor(settings), startingCards };
}

function round(x) { return Math.round(x * 100) / 100; }

// Rank every legal corner. Returns best-first.
export function rankSpots(board, settings, { mine = [], occupied = [] } = {}) {
  const facts = boardFacts(board);
  const legal = legalVertices(board.graph, occupied);
  const maxPips = Math.max(...board.graph.vertices.map(v => vertexProduction(board, v.id).pips));   // board-wide, so 'the most on the board' stays true when corners are taken
  return legal.map(v => scoreVertex(board, settings, v, { mine, occupied, facts, maxPips })).sort((a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id);
}

// Compare a chosen corner against the best one: which reasons the best has that the pick lacks.
export function compare(best, pick) {
  const out = [];
  if (best.id === pick.id) return out;
  if (best.pips > pick.pips) out.push(`${best.pips} pips versus your ${pick.pips}.`);
  for (const k of ['pair', 'port', 'expansion', 'complement', 'commodity']) {
    const b = best.parts.filter(p => p.k === k).reduce((s, p) => s + (p.v || 0), 0);
    const p = pick.parts.filter(p => p.k === k).reduce((s, p) => s + (p.v || 0), 0);
    if (b - p >= 0.5 && p <= 0) out.push(best.parts.find(x => x.k === k).text);   // only what the pick genuinely lacks
  }
  const bp = pick.parts.filter(p => p.k === 'repeat').reduce((s, p) => s + (p.v || 0), 0);
  const bb = best.parts.filter(p => p.k === 'repeat').reduce((s, p) => s + (p.v || 0), 0);
  if (bp < bb) out.push('Your pick doubles up on a number the best spot does not.');
  return out;
}

// Grade a corner against the ranking it was chosen from. Presentation only — no effect on scores.
// "good" = one of the top N corners where N is the player count: those are the corners an
// N-player table will fight over, so landing one is a good outcome even if it is not #1.
// The 90% share line between "fair" and "weak" is the author's choice (see RESEARCH.md).
export function grade(pick, ranking, players) {
  const total = ranking.length;
  const found = ranking.some(r => r.id === pick.id);
  const rank = found ? 1 + ranking.filter(r => r.score > pick.score).length : total + 1;   // ties share the higher rank
  const best = ranking.length ? ranking[0].score : 0;
  const pct = found && best > 0 ? Math.round(pick.score / best * 100) : found ? 100 : 0;
  const tier = rank === 1 ? 'great' : rank <= players ? 'good' : pct >= 90 ? 'fair' : 'weak';
  const label = { great: 'Great pick', good: 'Good pick', fair: 'Fair pick', weak: 'Weak pick' }[tier];
  const why = {
    great: 'the best open corner on the board.',
    good: `one of the top ${players} open corners, the ones a ${players}-player table fights over.`,
    fair: `not in the top ${players}, but it still scores ${pct}% of the best corner.`,
    weak: `outside the top ${players} and only ${pct}% of the best corner.`,
  }[tier];
  return { rank, total, pct, tier, label, why };
}

// Project the whole opening draft: seats 1..N pick in order, then N..1 (the snake), each taking the
// best legal corner for its own seat plan; second picks complement that seat's first. Pieces already
// on the board are consumed in turn order (mine at my seat's turns, opponent marks at the others'),
// so the projection only simulates the turns that have not happened yet. Presentation only.
export function simulateDraft(board, settings, { me = [], opp = [] } = {}) {
  const N = settings.players, S = settings.seat;
  const order = [...Array.from({ length: N }, (_, i) => i + 1), ...Array.from({ length: N }, (_, i) => N - i)];
  const occupied = [...me, ...opp];
  const firsts = {};
  const out = [];
  let mi = 0, oi = 0;
  order.forEach((seat, slot) => {
    const round = slot < N ? 1 : 2;
    let id, actual = true, score = null;
    if (seat === S) { if (mi < me.length) id = me[mi++]; }
    else if (oi < opp.length) id = opp[oi++];
    if (id === undefined) {
      const rk = rankSpots(board, { ...settings, seat }, { mine: round === 2 && firsts[seat] !== undefined ? [firsts[seat]] : [], occupied });
      if (!rk.length) return;
      id = rk[0].id; actual = false; score = rk[0].score; occupied.push(id);
    }
    if (round === 1) firsts[seat] = id;
    out.push({ seat, round, id, actual, you: seat === S, score });
  });
  return out;
}

// R13 starting road: the free road that comes with a settlement should point at the best open corner
// you can actually reach (two roads away), preferring a direction that keeps more than one option
// open. Targets are scored with the same ranking as everything else (so a fed port or a resource
// you lack counts, as the guides say), and a corner is only a target if it stays legal once this
// settlement is placed. Returns null when every corner two roads away is taken (a dead end).
export function suggestRoad(board, settings, vid, { mine = [], occupied = [] } = {}) {
  const g = board.graph, v = g.vertices[vid];
  const facts = boardFacts(board);
  const taken = new Set([...occupied, vid]);
  const mineAfter = mine.includes(vid) ? mine : [...mine, vid];
  // A target the other seats will take (or block) before your next turn is not worth aiming at: play the
  // rest of the opening draft forward and keep only corners that survive it. Over the same 400 simulated openings
  // (bench/catanatron/road_deadends.py) the first road ended in a dead end after setup 52% of the time without this
  // filter and 22% with it. If nothing survives, fall back to what is open now.
  const projected = simulateDraft(board, settings, { me: mineAfter, opp: occupied.filter(x => !mineAfter.includes(x)) }).filter(d => !d.you && !d.actual).map(d => d.id);
  const now = new Set(legalVertices(g, [...taken]));
  const safe = new Set(legalVertices(g, [...taken, ...projected]));
  const reachable = set => v.neighbors.some(n => !taken.has(n) && g.vertices[n].neighbors.some(nn => nn !== vid && set.has(nn)));
  const contested = !reachable(safe);
  const after = contested ? now : safe;
  const maxPips = Math.max(...g.vertices.map(x => vertexProduction(board, x.id).pips));
  let pick = null;
  for (const n of v.neighbors) {
    if (taken.has(n)) continue;                                   // a road into an occupied corner leads nowhere
    const targets = g.vertices[n].neighbors.filter(nn => nn !== vid && after.has(nn))
      .map(nn => scoreVertex(board, settings, nn, { mine: mineAfter, occupied: [...taken], facts, maxPips }))
      .sort((a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id);
    if (!targets.length) continue;
    const c = { via: n, target: targets[0], options: targets.length };
    if (!pick || c.target.score > pick.target.score || (c.target.score === pick.target.score && c.options > pick.options)) pick = c;
  }
  if (!pick) return null;
  const edge = v.edges.find(e => g.edges[e].v.includes(pick.via));
  const t = pick.target;
  const port = portsAt(board, t.id)[0];
  const describeCorner = c => `${c.pips}-pip corner (${Object.entries(c.prod).map(([r, p]) => `${p} ${NAMES[r].toLowerCase()}`).join(', ') || 'no production'})`;
  // Say why a better-looking corner within reach was skipped: it will probably be gone by your next turn.
  const twoAway = new Set(v.neighbors.filter(n => !taken.has(n)).flatMap(n => g.vertices[n].neighbors).filter(nn => nn !== vid));
  const lost = contested ? null : [...twoAway].filter(x => now.has(x) && !safe.has(x))
    .map(x => scoreVertex(board, settings, x, { mine: mineAfter, occupied: [...taken], facts, maxPips })).filter(x => x.score > t.score)
    .sort((a, b) => b.score - a.score || a.id - b.id)[0];
  const text = `Road: point it toward the ${describeCorner(t)}${port !== undefined ? `, which sits on the ${port === '3:1' ? '3:1' : '2:1 ' + NAMES[port].toLowerCase()} port` : ''}. ${contested ? 'Every direction is contested: the other seats are likely to take or block it before your next turn.' : pick.options > 1 ? `${pick.options} open corners lie that way, so the direction stays flexible.` : 'It is the only open corner that way, so take it before someone else does.'}${lost ? ` The ${describeCorner(lost)} nearby is likely to be taken or blocked before your next turn.` : ''}`;
  return { edge, via: pick.via, target: { id: t.id, score: t.score, pips: t.pips, prod: t.prod, numbers: t.numbers }, options: pick.options, text };
}

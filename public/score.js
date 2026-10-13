// Placement scoring. Every term maps to a rule in docs/RESEARCH.md (R1..R12); the `parts`
// array carries the plain-English reason for each term so the UI never invents a sentence.
import { PIPS, RESOURCES, SETUPS, landReadiness, harborStatus } from './board.js';
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

// R10 picks the plan from your seat. You can also choose one of the two plans for your own seat (strategy
// modes); Cities & Knights keeps its own weighting either way. Other seats always keep the seat rule.
export const PLAN_CHOICES = ['ows', 'road'];
export function planFor(settings) {
  if (settings.cak) return 'cak';
  if (PLAN_CHOICES.includes(settings.plan)) return settings.plan;
  return settings.seat <= Math.ceil(settings.players / 2) ? 'ows' : 'road';
}

// Per-board caches. A board's tiles never change once it is built (the editor builds a new board on every
// edit), so board-wide facts and each corner's production are worked out once per board, not once per corner
// scored. Cached production is frozen, so an accidental edit fails loudly instead of corrupting later scores.
const FACTS = new WeakMap(), PRODUCTION = new WeakMap(), MAX_PIPS = new WeakMap();

// Board-wide facts used by the scarcity rule (R3) and by the explanations.
export function boardFacts(board) {
  let facts = FACTS.get(board.hexes);
  if (!facts) FACTS.set(board.hexes, facts = computeBoardFacts(board));
  return facts;
}
function computeBoardFacts(board) {
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
    const expected = tiles[r] / land, actual = total > 0 ? pips[r] / total : expected;
    scarcity[r] = actual === 0 ? 1.25 : Math.min(1.25, Math.max(0.8, expected / actual));
  }
  return { pips, marquee, total, scarcity };
}

function vertexProduction(board, vid) {
  let cache = PRODUCTION.get(board.hexes);
  if (!cache) PRODUCTION.set(board.hexes, cache = new Map());
  let result = cache.get(vid);
  if (!result) cache.set(vid, result = computeProduction(board, vid));
  return result;
}
function computeProduction(board, vid) {
  const prod = {};
  const numbers = [];
  for (const hid of board.graph.vertices[vid].hexes) {
    const h = board.hexes[hid];
    if (!h.number) continue;
    prod[h.resource] = (prod[h.resource] || 0) + PIPS[h.number];
    numbers.push(h.number);
  }
  return Object.freeze({ prod: Object.freeze(prod), numbers: Object.freeze(numbers), pips: Object.values(prod).reduce((s, x) => s + x, 0) });
}
const maxPipsOf = board => {
  let max = MAX_PIPS.get(board.hexes);
  if (max === undefined) MAX_PIPS.set(board.hexes, max = Math.max(...board.graph.vertices.map(v => vertexProduction(board, v.id).pips)));
  return max;
};

function portsAt(board, vid) {
  const v = board.graph.vertices[vid];
  return v.edges.filter(e => board.harbors[e] !== undefined).map(e => board.harbors[e]);
}

const BUILDS = [
  { key: 'road', label: 'Road', cost: { wood: 1, brick: 1 } },
  { key: 'settlement', label: 'Settlement', cost: { wood: 1, brick: 1, wheat: 1, sheep: 1 } },
  { key: 'city', label: 'City', cost: { wheat: 2, ore: 3 } },
  { key: 'development', label: 'Development card', cost: { wheat: 1, sheep: 1, ore: 1 } },
];

export function openingFacts(board, settlements) {
  if (!board?.graph || !Array.isArray(settlements) || settlements.length !== 2 ||
      settlements.some(id => !Number.isInteger(id) || !board.graph.vertices[id]) ||
      !legalVertices(board.graph, [settlements[0]]).includes(settlements[1]) ||
      !landReadiness(board).ready || !harborStatus(board).valid) return null;
  const emptyResources = () => Object.fromEntries(RESOURCES.map(r => [r, 0]));
  const pips = emptyResources(), startingCards = emptyResources();
  const rolls = Array.from({ length: 11 }, (_, i) => ({ number: i + 2, ways: i + 2 === 7 ? 6 : PIPS[i + 2], cards: emptyResources(), totalCards: 0 }));
  settlements.forEach((id, index) => {
    for (const hid of board.graph.vertices[id].hexes) {
      const hex = board.hexes[hid];
      if (!RESOURCES.includes(hex.resource) || !PIPS[hex.number]) continue;
      pips[hex.resource] += PIPS[hex.number];
      const roll = rolls[hex.number - 2];
      roll.cards[hex.resource]++; roll.totalCards++;
      if (index === 1) startingCards[hex.resource]++;
    }
  });
  const ports = [...new Set(settlements.flatMap(id => portsAt(board, id)))];
  const tradeRates = Object.fromEntries(RESOURCES.map(r => [r, ports.includes(r) ? 2 : ports.includes('3:1') ? 3 : 4]));
  const builds = BUILDS.map(({ key, label, cost }) => {
    const needs = Object.fromEntries(Object.entries(cost).map(([r, amount]) => [r, amount - startingCards[r]]).filter(([, amount]) => amount > 0));
    return { key, label, cost: { ...cost }, needs, handCoversCost: Object.keys(needs).length === 0, missingProduction: RESOURCES.filter(r => cost[r] && pips[r] === 0) };
  });
  return { pips, totalPips: Object.values(pips).reduce((a, b) => a + b, 0), incomeWays: rolls.reduce((sum, r) => sum + (r.totalCards ? r.ways : 0), 0),
    rolls, startingCards, ports, tradeRates, builds, missingResources: RESOURCES.filter(r => pips[r] === 0) };
}

const NAMES = { wood: 'wood', brick: 'brick', wheat: 'wheat', sheep: 'sheep', ore: 'ore' };
const list = arr => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Score one corner. `mine` = my settlements already on the board; `occupied` = every settlement.
// `explain: false` skips writing the sentences (for projections nobody reads); every value is the same.
export function scoreVertex(board, settings, vid, { mine = [], occupied = [], facts = boardFacts(board), maxPips = 0, explain = true } = {}) {
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
  parts.push({ k: 'production', v: round(base), text: explain && `${pips} pips of production — ${rank}: ${list(Object.entries(prod).map(([r, p]) => `${p} ${NAMES[r]}`))}.` });
  const scarce = resources.filter(r => facts.scarcity[r] >= 1.15 && prod[r] >= 3);
  if (scarce.length) parts.push({ k: 'scarcity', v: null, text: explain && `${cap(list(scarce.map(r => NAMES[r])))} ${scarce.length > 1 ? 'are' : 'is'} scarce on this board (${list(scarce.map(r => `${facts.pips[r]} pips of ${NAMES[r]} anywhere`))}), so this corner's share is worth a trading premium.` });
  const plentiful = resources.filter(r => facts.scarcity[r] <= 0.85 && prod[r] >= 3);
  if (plentiful.length) parts.push({ k: 'plenty', v: null, text: explain && `${cap(list(plentiful.map(r => NAMES[r])))} ${plentiful.length > 1 ? 'are' : 'is'} plentiful on this board, so it trades cheaply — counted at a discount.` });

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
  if (repeats) parts.push({ k: 'repeat', v: -repeatPen, text: explain && `Repeats ${list([...new Set(repeated)].map(String))} — extra production on the same number does not add another paying roll. A nudge, not a veto.` });

  // R7 ports (on the corner, or a potential settlement two roads away at half value)
  const minePips = mine.reduce((acc, m) => { const p = vertexProduction(board, m).prod; for (const r in p) acc[r] = (acc[r] || 0) + p[r]; return acc; }, {});
  const ownedPorts = new Set(mine.flatMap(m => portsAt(board, m)));
  const portValue = (type, mul, where) => {
    if (type === '3:1') return { v: PORT.generic * mul, text: explain && `${where} the 3:1 port — the flexible port top players value most.` };
    const have = (prod[type] || 0) + (minePips[type] || 0);
    if (have >= PORT.matchPips) return { v: PORT.matched * mul, text: explain && `${where} the 2:1 ${NAMES[type]} port with ${have} pips of ${NAMES[type]} to feed it — a private trading post that never says no.` };
    return { v: PORT.unmatched * mul, text: explain && `${where} the 2:1 ${NAMES[type]} port, but with only ${have} pips of ${NAMES[type]} it will rarely be used.` };
  };
  const v = board.graph.vertices[vid];
  const taken = new Set([...occupied, vid]);
  const after = { has: id => !taken.has(id) && !board.graph.vertices[id].neighbors.some(n => taken.has(n)) };   // corners still open once this one is taken
  let port = null;
  for (const t of portsAt(board, vid)) {
    if (ownedPorts.has(t)) {
      parts.push({ k: 'port-owned', v: null, text: explain && `You already have ${t === '3:1' ? '3:1' : '2:1 ' + NAMES[t]} port access from an owned settlement. Another copy does not improve your trade rate, so it adds no port bonus.` });
      continue;
    }
    const c = portValue(t, plan.portMul, 'Sits on'); if (!port || c.v > port.v) port = c;
  }
  if (!port) for (const n of v.neighbors) for (const target of board.graph.vertices[n].neighbors) {
    if (!after.has(target)) continue;
    for (const t of portsAt(board, target)) {
      if (ownedPorts.has(t)) continue;
      const c = portValue(t, plan.portMul * PORT.farMul, 'Two roads and a new settlement would reach'); if (!port || c.v > port.v) port = c;
    }
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
  if (best && best.pips >= 8) parts.push({ k: 'expansion', v: round(expansion), text: explain && `Room to grow: ${best.pips === 8 || best.pips === 11 || best.pips === 18 ? 'an' : 'a'} ${best.pips}-pip corner (${list(Object.entries(best.prod).map(([r, p]) => `${p} ${NAMES[r]}`))}) sits two roads away.` });
  else if (best) parts.push({ k: 'expansion', v: round(expansion), text: explain && `Room to grow is thin: the best open corner two roads away has only ${best.pips} pip${best.pips === 1 ? '' : 's'}.` });
  else parts.push({ k: 'expansion', v: 0, text: 'No open settlement site two roads away. Longer routes are not included in this expansion bonus.' });

  // R9 second-settlement complement
  let complement = 0;
  if (mine.length) {
    const missing = RESOURCES.filter(r => !minePips[r]);
    const covers = resources.filter(r => missing.includes(r));
    for (const r of covers) complement += (r === 'wheat' || r === 'ore') ? COMPLEMENT.key : COMPLEMENT.any;
    if (covers.length) parts.push({ k: 'complement', v: round(complement), text: explain && `Patches your first settlement: adds ${list(covers.map(r => NAMES[r]))}${covers.some(r => r === 'wheat' || r === 'ore') ? ' — the wheat/ore you need for cities' : ''}.` });
    const stillMissing = missing.filter(r => !covers.includes(r));
    if (stillMissing.length) parts.push({ k: 'gap', v: null, text: explain && `You would still have no ${list(stillMissing.map(r => NAMES[r]))}.` });
  }

  // R11 commodity hexes (C&K only)
  let commodity = 0;
  if (plan.commodity) {
    const c = v.hexes.map(h => board.hexes[h]).filter(h => h.number && COMMODITY_HEXES.has(h.resource));
    commodity = c.length * plan.commodity;
    if (c.length) parts.push({ k: 'commodity', v: commodity, text: explain && `${c.length} commodity hex${c.length > 1 ? 'es' : ''} (${list(c.map(h => NAMES[h.resource]))}) — a city here also produces ${list(c.map(h => ({ wood: 'paper', sheep: 'cloth', ore: 'coin' })[h.resource]))}.` });
  }

  const score = round(base + pair - repeatPen + (port ? port.v : 0) + expansion + complement + commodity);
  const cards = {};
  for (const hid of v.hexes) { const h = board.hexes[hid]; if (h.number) cards[h.resource] = (cards[h.resource] || 0) + 1; }
  const startingCards = mine.length ? Object.entries(cards).map(([r, c]) => `${c} ${NAMES[r]}`) : [];   // R9: one card per adjacent hex
  return { id: vid, score, pips, prod, numbers, resources, parts, plan: planFor(settings), startingCards };
}

function round(x) {
  const cents = x * 100, half = Math.floor(cents) + 0.5;
  const noise = 8 * Number.EPSILON * Math.max(1, Math.abs(cents));
  return Math.round(Math.abs(cents - half) <= noise ? half : cents) / 100;
}

// Rank every legal corner. Returns best-first.
export function rankSpots(board, settings, { mine = [], occupied = [], explain = true } = {}) {
  const facts = boardFacts(board);
  const legal = legalVertices(board.graph, occupied);
  const maxPips = maxPipsOf(board);   // board-wide, so 'the most on the board' stays true when corners are taken
  return legal.map(v => scoreVertex(board, settings, v, { mine, occupied, facts, maxPips, explain })).sort((a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id);
}

// Explain a higher-ranked corner using its existing score terms.
export function compare(best, pick) {
  const out = [];
  if (best.id === pick.id || best.score <= pick.score) return out;
  if (best.pips > pick.pips) out.push(`${best.pips} pips versus your ${pick.pips}.`);
  for (const k of ['pair', 'port', 'expansion', 'complement', 'commodity']) {
    const b = best.parts.filter(p => p.k === k).reduce((s, p) => s + (p.v || 0), 0);
    const p = pick.parts.filter(p => p.k === k).reduce((s, p) => s + (p.v || 0), 0);
    if (b - p >= 0.5 && p <= 0) out.push(best.parts.find(x => x.k === k).text);   // only what the pick genuinely lacks
  }
  const bp = pick.parts.filter(p => p.k === 'repeat').reduce((s, p) => s + (p.v || 0), 0);
  const bb = best.parts.filter(p => p.k === 'repeat').reduce((s, p) => s + (p.v || 0), 0);
  if (bp < bb) out.push(`Repeated-number penalty: your pick loses ${Math.abs(bp).toFixed(2)} points, versus ${Math.abs(bb).toFixed(2)} for #1.`);
  if (!out.length && best.score > pick.score) {
    const labels = {
      production: 'Weighted production after resource value and scarcity',
      pair: 'Resource pairs', port: 'Harbour access', expansion: 'Room to grow',
      complement: 'Covering missing resources', commodity: 'Commodity hexes', repeat: 'Number diversity',
    };
    const advantages = Object.entries(labels).map(([k, label]) => {
      const value = r => r.parts.filter(p => p.k === k).reduce((sum, p) => sum + (p.v || 0), 0);
      const b = value(best), p = value(pick);
      return { label, b, p, delta: round(b - p) };
    }).filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta);
    if (best.pips < pick.pips) out.push(`#1 has ${best.pips} raw pips and your pick has ${pick.pips} raw pips; your pick produces more cards on average before any robber effects.`);
    for (const x of advantages) out.push(`${x.label}: ${x.b.toFixed(2)} score points for #1 versus ${x.p.toFixed(2)} for your pick.`);
    if (!advantages.length) out.push(`A near tie: the total heuristic score is ${best.score.toFixed(2)} versus ${pick.score.toFixed(2)}. The individual terms round to the same values.`);
  }
  return out;
}

// Grade a corner against the ranking it was chosen from. Presentation only — no effect on scores.
// "good" = one of the top N corners where N is the player count: those are the corners an
// N-player table will fight over, so landing one is a good outcome even if it is not #1.
// The 90% share line between "fair" and "weak" is the author's choice (see RESEARCH.md).
// `unit` names what the ranking ranks: 'corner' (classic) or 'opening' (the look-ahead ranks whole openings).
export function grade(pick, ranking, players, unit = 'corner') {
  const total = ranking.length;
  const ranked = ranking.find(r => r.id === pick?.id);
  if (!ranked) return { rank: total + 1, total, pct: 0, gap: null, tier: 'weak', label: 'Unavailable pick', why: 'this corner is not in the current legal ranking.' };
  const rank = 1 + ranking.filter(r => r.score > ranked.score).length;   // ties share the higher rank
  const bestUnits = Math.round(ranking[0].score * 100), pickUnits = Math.round(ranked.score * 100);
  const pct = bestUnits > 0 && pickUnits >= 0 ? Math.floor(pickUnits * 10000 / bestUnits) / 100 : null;
  const gap = (bestUnits - pickUnits) / 100;
  const tier = rank === 1 ? 'great' : rank <= players ? 'good' : pct !== null && pct >= 90 ? 'fair' : 'weak';
  const label = { great: 'Great pick', good: 'Good pick', fair: 'Fair pick', weak: 'Weak pick' }[tier];
  const why = {
    great: unit === 'opening' ? 'the best opening on the board.' : 'the best open corner on the board.',
    good: unit === 'opening' ? `one of the top ${players} openings.` : `one of the top ${players} open corners, the ones a ${players}-player table fights over.`,
    fair: `not in the top ${players}, but it still scores ${pct}% of the best ${unit}.`,
    weak: pct === null ? `outside the top ${players} and ${gap.toFixed(2)} points below the best ${unit}.` : `outside the top ${players} and only ${pct}% of the best ${unit}.`,
  }[tier];
  return { rank, total, pct, gap, tier, label, why };
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
      const rk = rankSpots(board, { ...settings, seat, plan: seat === S ? settings.plan : undefined }, { mine: round === 2 && firsts[seat] !== undefined ? [firsts[seat]] : [], occupied, explain: false });
      if (!rk.length) return;
      id = rk[0].id; actual = false; score = rk[0].score; occupied.push(id);
    }
    if (round === 1) firsts[seat] = id;
    out.push({ seat, round, id, actual, you: seat === S, score });
  });
  return out;
}

const describeCorner = c => `${c.pips}-pip corner (${Object.entries(c.prod).map(([r, p]) => `${p} ${NAMES[r].toLowerCase()}`).join(', ') || 'no production'})`;

// The position a kept settlement was placed in, read from the placement history: your settlements before it
// (mine) and every settlement before it (occupied). Starting roads are not settlements, so they are skipped.
// Returns null when the settlement has no entry of its own, so callers withhold its advice instead of guessing;
// a first settlement legitimately gets two empty lists. The road functions below add the settlement itself
// (roadOptions), so leaving it out changes no road advice; scoreVertex does not, so it must stay out.
export function placementContext(history, vid) {
  const at = history.findIndex(h => h.k === 'me' && h.id === vid);
  if (at < 0) return null;
  const before = history.slice(0, at).filter(h => h.k !== 'road');
  return { mine: before.filter(h => h.k === 'me').map(h => h.id), occupied: before.map(h => h.id) };
}

// R13 starting road, one free side of the settlement at a time: the corners one road further on that
// a road along that side could aim at, best first. Shared by the suggested road and by the grade of a
// road the player places, so both judge a direction the same way. `projection` replaces the classic projected
// draft (the look-ahead policy passes its own, so the road always matches the projection on screen).
export function roadOptions(board, settings, vid, { mine = [], occupied = [], projection: given = null } = {}) {
  const g = board.graph, v = g.vertices[vid];
  const facts = boardFacts(board);
  const taken = new Set([...occupied, vid]);
  const mineAfter = mine.includes(vid) ? mine : [...mine, vid];
  // A target the other seats take (or block) in the projected opening is not worth aiming at: play the
  // rest of the opening draft forward and keep only corners that survive it. In the original 2026-09-29
  // comparison of 400 openings (bench/catanatron/road_deadends.py), the first road lacked a legal settlement
  // site one further road away after setup 52% of the time before this filter and 22% after. Those are historical
  // policy measurements. If nothing survives, fall back to what is open now.
  const projection = given || simulateDraft(board, settings, { me: mineAfter, opp: occupied.filter(x => !mineAfter.includes(x)) });
  const projected = projection.filter(d => !d.you && !d.actual).map(d => d.id);
  const now = new Set(legalVertices(g, [...taken]));
  const safe = new Set(legalVertices(g, [...taken, ...projected]));
  const reachable = set => v.neighbors.some(n => !taken.has(n) && g.vertices[n].neighbors.some(nn => nn !== vid && set.has(nn)));
  const contested = !reachable(safe);
  const after = contested ? now : safe;
  const maxPips = Math.max(...g.vertices.map(x => vertexProduction(board, x.id).pips));
  const score = id => scoreVertex(board, settings, id, { mine: mineAfter, occupied: [...taken], facts, maxPips });
  const directions = v.neighbors.filter(n => !taken.has(n)).map(n => {   // a road into an occupied corner leads nowhere
    const ahead = g.vertices[n].neighbors.filter(nn => nn !== vid);
    const targets = ahead.filter(nn => after.has(nn)).map(score).sort((a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id);
    return { via: n, edge: v.edges.find(e => g.edges[e].v.includes(n)), targets, open: ahead.filter(nn => now.has(nn)) };
  });
  return { directions, contested, now, safe, projection, score };
}

// R13 starting road: the free road that comes with a settlement should point at the best open corner
// you can actually reach (two roads away), preferring a direction that keeps more than one option
// open. Targets are scored with the same ranking as everything else (so a fed port or a resource
// you lack counts, as the guides say), and a corner is only a target if it stays legal once this
// settlement is placed. Returns null when every two-road destination is occupied or blocked;
// longer routes are outside this search.
export function suggestRoad(board, settings, vid, context = {}) {
  const g = board.graph;
  const { directions, contested, now, safe, projection, score } = roadOptions(board, settings, vid, context);
  let pick = null;
  for (const d of directions) {
    if (!d.targets.length) continue;
    const c = { via: d.via, edge: d.edge, target: d.targets[0], options: d.targets.length };
    if (!pick || c.target.score > pick.target.score || (c.target.score === pick.target.score && c.options > pick.options)) pick = c;
  }
  if (!pick) return null;
  const edge = pick.edge;
  const t = pick.target;
  const port = portsAt(board, t.id)[0];
  // Explain the projected placements behind a skipped corner and a target used for the own second pick.
  const twoAway = new Set(directions.flatMap(d => g.vertices[d.via].neighbors).filter(nn => nn !== vid));
  const lost = contested ? null : [...twoAway].filter(x => now.has(x) && !safe.has(x))
    .map(score).filter(x => x.score > t.score)
    .sort((a, b) => b.score - a.score || a.id - b.id)[0];
  const ownSecond = projection.find(d => d.you && d.round === 2 && !d.actual);
  const text = `Road: point it toward the ${describeCorner(t)}${port !== undefined ? `, which sits on the ${port === '3:1' ? '3:1' : '2:1 ' + NAMES[port].toLowerCase()} port` : ''}. ${contested ? 'Every direction is contested in the projected opening: the other seats take or block the two-road targets.' : pick.options > 1 ? `${pick.options} open corners lie that way, so the direction stays flexible.` : 'It is the only open corner that way, so take it before someone else does.'}${lost ? ` The ${describeCorner(lost)} nearby is taken or blocked by another seat in the projected opening.` : ''}${ownSecond?.id === t.id ? ' The opening projection also uses this target for your second settlement, so it would already be occupied when setup ends.' : ''}`;
  return { edge, via: pick.via, target: { id: t.id, score: t.score, pips: t.pips, prod: t.prod, numbers: t.numbers }, options: pick.options, text };
}

// The Fair line for road grades, on scores in integer hundredths: short of the best by at most a tenth of its
// size. For a positive best this is exactly grade()'s "at least 90% of the best"; measuring against |best| keeps
// a zero or negative best (possible on a mostly desert custom board) on the same footing.
export const withinTenth = (bestUnits, units) => 10 * (bestUnits - units) <= Math.abs(bestUnits);

// Grade a starting road the player placed along `edge`, a side of their settlement `vid`, with the same
// direction-by-direction evaluation as the suggested road (R13), so the two can never disagree about
// which way is best. Directions rank as suggestRoad orders them: the best open target two roads away,
// then how many targets lie that way. Great = the top direction (exact ties share it); Fair = its best
// target is within a tenth of the top direction's (90% or more, like settlement grades, when scores are
// positive); Weak = lower, or no target that way. Returns null when `edge` is not a free side of `vid`.
// Presentation only.
export function gradeRoad(board, settings, vid, edge, context = {}) {
  const { directions, contested, projection, score } = roadOptions(board, settings, vid, context);
  const own = directions.find(d => d.edge === edge);
  if (!own) return null;
  const value = d => d.targets[0].score;
  const reaching = directions.filter(d => d.targets.length);
  if (!reaching.length) return { tier: 'none', label: 'No two-road target', rank: null, pct: null, gap: null, target: null,
    why: 'no direction from this settlement has an open settlement site two roads away. Longer routes are not checked.', detail: null };
  const bestValue = Math.max(...reaching.map(value));
  if (!own.targets.length) {
    const blocked = contested ? null : own.open.map(score).sort((a, b) => b.score - a.score || a.id - b.id)[0];
    return { tier: 'weak', label: 'Weak road', rank: reaching.length + 1, pct: null, gap: null, target: null,
      why: blocked ? 'the open corners this way are taken or blocked by another seat in the projected opening.' : 'no legal settlement site is open two roads this way. Longer routes are not checked.',
      detail: blocked ? `The ${describeCorner(blocked)} this way is taken or blocked by another seat in the projected opening.` : null };
  }
  const rank = 1 + reaching.filter(d => value(d) > value(own) || (value(d) === value(own) && d.targets.length > own.targets.length)).length;
  const bestUnits = Math.round(bestValue * 100), ownUnits = Math.round(value(own) * 100);
  const pct = bestUnits > 0 && ownUnits >= 0 ? Math.floor(ownUnits * 10000 / bestUnits) / 100 : null;
  const gap = (bestUnits - ownUnits) / 100;
  const tier = rank === 1 ? 'great' : withinTenth(bestUnits, ownUnits) ? 'fair' : 'weak';
  const label = { great: 'Great road', fair: 'Fair road', weak: 'Weak road' }[tier];
  const why = tier === 'great' ? 'the best direction from this settlement.'
    : gap === 0 ? 'its best target ties the best direction’s, but fewer open corners lie this way.'
    : pct === null ? `its best target is ${gap.toFixed(2)} points below the best direction’s.`
    : `its best target scores ${tier === 'weak' ? 'only ' : ''}${pct}% of the best direction’s, ${gap.toFixed(2)} points lower.`;
  const t = own.targets[0], port = portsAt(board, t.id)[0];
  const ownSecond = projection.find(d => d.you && d.round === 2 && !d.actual);
  const detail = `Your road points toward the ${describeCorner(t)}${port !== undefined ? `, which sits on the ${port === '3:1' ? '3:1' : '2:1 ' + NAMES[port].toLowerCase()} port` : ''}. ${own.targets.length > 1 ? `${own.targets.length} open corners lie that way.` : 'It is the only open corner that way.'}${ownSecond?.id === t.id ? ' The opening projection also uses this target for your second settlement, so it would already be occupied when setup ends.' : ''}${contested ? ' Every direction is contested in the projected opening, so this compares the corners open now.' : ''}`;
  return { tier, label, rank, pct, gap, target: { id: t.id, score: t.score, pips: t.pips }, why, detail };
}

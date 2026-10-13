// The look-ahead policy (draft-aware-2026-10-12, R14). Correctness is checked against a slow, independent reference
// that enumerates every first and second settlement with the classic functions and the rule constants as published in
// docs/RESEARCH.md; playing strength is a separate question for the benchmark, never assumed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, boardFrom, PIPS } from '../public/board.js';
import { rankSpots, scoreVertex, simulateDraft, grade, suggestRoad, gradeRoad, PLANS, planFor } from '../public/score.js';
import { legalVertices } from '../public/geometry.js';
import { POLICY, projectDraft, projectionFor, rankFirst, rankSecond, rankLookahead, compareLookahead, stability, OPPONENT_STYLES } from '../public/lookahead.js';

const S = (o = {}) => ({ players: 4, seat: 1, cak: false, ...o });
const pipsAt = (b, v) => b.graph.vertices[v].hexes.reduce((s, h) => s + (b.hexes[h].number ? PIPS[b.hexes[h].number] : 0), 0);
// Earlier seats' first settlements, placed as the projected draft has them (the position you face at your turn).
const before = (b, s) => simulateDraft(b, s).filter(d => d.round === 1 && d.seat < s.seat).map(d => d.id);

// ---- Independent reference ----------------------------------------------------------------------------------
// R7 and R8 as RESEARCH.md states them: 3:1 harbour 1.0, fed 2:1 (5+ pips of it across your settlements) 1.5, other
// 2:1 0.25, half value for a harbour reached by two roads and a new settlement, an owned type earns nothing; room to
// grow 0.10 x the pips of the best settlement site two roads away. Here both are judged at the end of the projected
// setup, and a corner or harbour type is credited to one settlement at most, whichever split is worth more.
const RULE = { generic: 1.0, matched: 1.5, unmatched: 0.25, matchPips: 5, far: 0.5, room: 0.10 };
const cents = x => { const c = x * 100, half = Math.floor(c) + 0.5; return Math.round(Math.abs(c - half) <= 8 * Number.EPSILON * Math.max(1, Math.abs(c)) ? half : c); };
const sitesTwoRoadsFrom = (b, v) => [...new Set(b.graph.vertices[v].neighbors.flatMap(n => b.graph.vertices[n].neighbors))].filter(t => t !== v);
const harboursAt = (b, v) => b.graph.vertices[v].edges.filter(e => b.harbors[e]).map(e => b.harbors[e]);
function fedBy(b, ids) {
  const fed = {};
  for (const v of ids) for (const h of b.graph.vertices[v].hexes) { const x = b.hexes[h]; if (x.number) fed[x.resource] = (fed[x.resource] || 0) + PIPS[x.number]; }
  return fed;
}
// Every harbour credit one settlement could take, as [type, cents]: harbours on the corner when any is creditable,
// otherwise harbours at open sites two roads away. `skip` is a type the other settlement is credited with.
function portOptions(b, s, v, mine, open, skip) {
  const mul = PLANS[planFor(s)].portMul, fed = fedBy(b, [v, ...mine]), owned = new Set(mine.flatMap(m => harboursAt(b, m)));
  const worth = (t, m) => cents((t === '3:1' ? RULE.generic : (fed[t] || 0) >= RULE.matchPips ? RULE.matched : RULE.unmatched) * m);
  const direct = harboursAt(b, v).filter(t => !owned.has(t) && t !== skip).map(t => [t, worth(t, mul)]);
  if (direct.length) return direct;
  return sitesTwoRoadsFrom(b, v).filter(d => open.has(d)).flatMap(d => harboursAt(b, d)).filter(t => !owned.has(t) && t !== skip).map(t => [t, worth(t, mul * RULE.far)]);
}
const bestOf = options => options.reduce((a, o) => (!a || o[1] > a[1] ? o : a), null);
function refPorts(b, s, f, sec, open) {
  const one = skip => bestOf(portOptions(b, s, f, [], open, skip)), two = skip => bestOf(portOptions(b, s, sec, [f], open, skip));
  const val = o => (o ? o[1] : 0), p = one(null), q = two(null);
  if (!p || !q || p[0] !== q[0]) return val(p) + val(q);
  return Math.max(val(p) + val(two(p[0])), val(one(q[0])) + val(q));
}
function refRooms(b, f, sec, open) {
  const targets = v => sitesTwoRoadsFrom(b, v).filter(t => open.has(t));
  let best = 0;
  for (const t1 of [null, ...targets(f)]) for (const t2 of [null, ...targets(sec)]) {
    if (t1 !== null && t1 === t2) continue;
    best = Math.max(best, (t1 === null ? 0 : cents(pipsAt(b, t1) * RULE.room)) + (t2 === null ? 0 : cents(pipsAt(b, t2) * RULE.room)));
  }
  return best;
}
function refCore(b, s, v, mine) {
  const c = scoreVertex(b, s, v, { mine, occupied: [] });
  return cents(c.score) - ['port', 'expansion'].reduce((sum, k) => sum + cents(c.parts.find(p => p.k === k)?.v || 0), 0);
}
function refOpening(b, s, f, sec, end) {
  const open = new Set(legalVertices(b.graph, end));
  return refCore(b, s, f, []) + refCore(b, s, sec, [f]) + refPorts(b, s, f, sec, open) + refRooms(b, f, sec, open);
}
const best = list => list.reduce((a, x) => (!a || x.cents > a.cents || (x.cents === a.cents && (x.pips > a.pips || (x.pips === a.pips && x.id < a.id))) ? x : a), null);
// Every legal second settlement, unpruned, valued as the whole opening; the other seats by the classic draft.
function refSeconds(b, s, first, atSecond) {
  const opp = atSecond.filter(x => x !== first);
  return legalVertices(b.graph, atSecond).map(id => ({ id, pips: pipsAt(b, id), cents: refOpening(b, s, first, id, simulateDraft(b, s, { me: [first, id], opp }).map(d => d.id)) }));
}
// Every legal first settlement, each with the second that makes its best opening at my second turn.
function refFirsts(b, s, opp) {
  const mySecondSlot = 2 * s.players - s.seat;
  return legalVertices(b.graph, opp).map(id => {
    const projected = simulateDraft(b, s, { me: [id], opp }).filter((d, slot) => !d.actual && slot < mySecondSlot).map(d => d.id);
    const second = best(refSeconds(b, s, id, [id, ...opp, ...projected]));
    return { id, pips: pipsAt(b, id), cents: second.cents, second: second.id };
  });
}
const ordered = list => list.slice().sort((x, y) => y.cents - x.cents || y.pips - x.pips || x.id - y.id);

// ---- Tests ------------------------------------------------------------------------------------------------------
test('the projection is the classic draft: same order, consumption of placed pieces and picks (no self-recursion)', () => {
  let states = 0;
  for (const players of [3, 4, 5, 6]) for (let seed = 1; seed <= 4; seed++) {
    const b = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed });
    for (let seat = 1; seat <= players; seat++) for (const [cak, plan] of [[false, undefined], [true, undefined], [false, seat % 2 ? 'road' : 'ows']]) {
      const s = { players, seat, cak, ...(plan ? { plan } : {}) }, full = simulateDraft(b, s);
      for (let k = 0; k <= full.length; k += 3) {
        const me = full.slice(0, k).filter(d => d.you).map(d => d.id), opp = full.slice(0, k).filter(d => !d.you).map(d => d.id);
        assert.deepEqual(projectDraft(b, s, { me, opp }), simulateDraft(b, s, { me, opp }));
        states++;
      }
    }
  }
  assert.ok(states > 450);
});

test('first-pick ranking matches the exhaustive reference exactly: every seat, three players, Cities & Knights, both plans', () => {
  for (const [seed, o] of [[3, { seat: 1 }], [3, { seat: 2 }], [5, { seat: 3 }], [3, { seat: 4 }], [6, { players: 3, seat: 2 }], [4, { seat: 2, cak: true }], [8, { seat: 1, plan: 'road' }], [9, { seat: 4, plan: 'ows' }]]) {
    const b = generateBoard({ seed }), s = S(o), opp = before(b, s);
    const ours = rankFirst(b, s, { opp }).map(x => [x.id, cents(x.score), x.second?.id ?? null]);
    assert.deepEqual(ours, ordered(refFirsts(b, s, opp)).map(x => [x.id, x.cents, x.second]), `seed ${seed} ${JSON.stringify(o)}`);
  }
});

test('second-pick ranking matches the exhaustive reference, and its pruning is exact on 70 positions', () => {
  let positions = 0;
  for (const players of [3, 4, 6]) for (let seed = 1; seed <= 10; seed++) {
    const b = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed });
    for (let seat = 1; seat <= players; seat += 2) {
      const s = { players, seat, cak: seed % 2 === 0 };
      const draft = simulateDraft(b, s), mySecond = 2 * players - seat;
      const first = draft.find(d => d.you).id;
      const occupied = [first, ...draft.slice(0, mySecond).filter(d => !d.you).map(d => d.id)];
      const pruned = rankSecond(b, s, first, occupied), all = rankSecond(b, s, first, occupied, { all: true });
      assert.deepEqual([pruned[0].id, pruned[0].score], [all[0].id, all[0].score]);
      assert.ok(all.length >= pruned.length);
      if (seed <= 3) assert.deepEqual(all.map(x => [x.id, cents(x.score)]), ordered(refSeconds(b, s, first, occupied)).map(x => [x.id, x.cents]), `${players}p seed ${seed} seat ${seat}`);
      positions++;
    }
  }
  assert.equal(positions, 70);
});

test('last seat, seed 3: the best corner alone is not the best opening, and the look-ahead finds the stronger pair', () => {
  const b = generateBoard({ seed: 3 }), s = S({ seat: 4 }), opp = before(b, s);
  assert.deepEqual(opp, [43, 3, 20]);
  const classicTop = rankSpots(b, s, { mine: [], occupied: opp })[0];
  const la = rankLookahead(b, s, { me: [], opp });
  const greedy = la.find(x => x.id === classicTop.id);
  assert.equal(classicTop.id, 41, 'the classic ranking takes the 41 corner first');
  assert.deepEqual([la[0].id, la[0].second.id], [33, 41], 'the look-ahead takes 33 first and keeps 41 for the immediate second pick');
  assert.deepEqual([greedy.second.id, greedy.score, la[0].score], [15, 26.35, 28.07]);
  assert.ok(la[0].own < greedy.own, 'it gives up some own-corner score for a better opening');
  const ref = best(refFirsts(b, s, opp));
  assert.deepEqual([ref.id, ref.second, ref.cents], [33, 41, 2807], 'the exhaustive reference agrees');
});

test('last seat, seed 1: when the best corner alone is also the best opening, the look-ahead keeps it', () => {
  const b = generateBoard({ seed: 1 }), s = S({ seat: 4 }), opp = before(b, s);
  assert.equal(rankLookahead(b, s, { me: [], opp })[0].id, rankSpots(b, s, { mine: [], occupied: opp })[0].id);
});

test('a corner both settlements could grow to counts once, for the settlement where it is worth more overall', () => {
  // Seed 1, seat 4, the opening 42 then 32: both settlements' best room to grow is the same corner.
  const b = generateBoard({ seed: 1 }), s = S({ seat: 4 }), opp = before(b, s), r = rankLookahead(b, s, { me: [], opp }).find(x => x.id === 42);
  assert.equal(r.second.id, 32);
  const end = new Set(legalVertices(b.graph, r.projection.map(d => d.id)));
  const top = v => sitesTwoRoadsFrom(b, v).filter(t => end.has(t)).sort((x, y) => pipsAt(b, y) - pipsAt(b, x) || x - y)[0];
  assert.equal(top(42), top(32), 'the same corner is the best room to grow for both');
  assert.match(r.parts.find(p => p.k === 'expansion').text, /counts once, for your second settlement\.$/);
  assert.equal(cents(r.score), refOpening(b, s, 42, 32, r.projection.map(d => d.id)));
  assert.ok(cents(r.score) < refCore(b, s, 42, []) + refCore(b, s, 32, [42]) + refPorts(b, s, 42, 32, end) + 2 * cents(pipsAt(b, top(42)) * RULE.room), 'it is not counted twice');
});

test('a harbour type both settlements could use counts once; a harbour the projected setup takes adds nothing', () => {
  // Seed 1, seat 1: the opening 33 then 50 could both credit the same harbour type.
  const b = generateBoard({ seed: 1 }), top = rankLookahead(b, S(), { me: [], opp: [] })[0];
  assert.deepEqual([top.id, top.second.id], [33, 50]);
  assert.match(top.parts.find(p => p.k === 'port').text, /port counts once, for your second settlement\.$/);
  assert.equal(cents(top.score), refOpening(b, S(), 33, 50, top.projection.map(d => d.id)));
  // Seed 1, seat 4, the opening 41 then 38: the harbour two roads from 41 is open now, but its site is gone by the end.
  const s4 = S({ seat: 4 }), r = rankLookahead(b, s4, { me: [], opp: before(b, s4) })[0];
  assert.deepEqual([r.id, r.second.id], [41, 38]);
  const port = r.parts.find(p => p.k === 'port');
  assert.deepEqual([port.v, port.text], [0, 'A port two roads away is open now, but the projected setup takes or blocks its settlement site, so it adds nothing.']);
});

test('room to grow counts only a corner still open when setup ends, and says so', () => {
  // Seed 5, seat 3: the opening 32 then 33 has corners two roads away now, and the projected setup takes them all.
  const b = generateBoard({ seed: 5 }), s = S({ seat: 3 }), r = rankLookahead(b, s, { me: [], opp: before(b, s) }).find(x => x.id === 32);
  assert.equal(r.second.id, 33);
  const part = r.parts.find(p => p.k === 'expansion');
  assert.deepEqual([part.v, part.text], [0, 'Room to grow: the corners two roads away are open now, but the projected setup takes or blocks every one of them, so this adds nothing.']);
});

test('ranked for your turn: seats before you that have not placed are projected first, and the advice holds after you keep it', () => {
  for (const [seed, seat] of [[3, 3], [7, 2], [11, 4], [5, 1]]) {
    const b = generateBoard({ seed }), s = S({ seat });
    const ahead = simulateDraft(b, s).filter(d => d.round === 1 && d.seat < seat).map(d => d.id);
    const la = rankLookahead(b, s, { me: [], opp: [] });
    assert.deepEqual(la.map(x => x.id).sort((x, y) => x - y), legalVertices(b.graph, ahead).sort((x, y) => x - y), 'only corners open at your turn are ranked');
    assert.deepEqual(la.map(x => [x.id, x.score]), rankFirst(b, s, { opp: ahead }).map(x => [x.id, x.score]));
    // Keep the recommendation with nobody marked: the second-settlement advice is the second the card promised, and the
    // projection is the same draft, now with the first settlement actually on the board.
    const top = la[0], next = rankLookahead(b, s, { me: [top.id], opp: [] });
    assert.equal(next[0].id, top.second.id, `seed ${seed} seat ${seat}: the promised second`);
    const shape = p => p.map(d => [d.seat, d.round, d.id]);
    assert.deepEqual(shape(next[0].projection), shape(top.projection));
    assert.deepEqual(top.projection.filter(d => d.you).map(d => d.actual), [false, false], 'nothing of mine is placed before Keep');
    assert.deepEqual(next[0].projection.filter(d => d.you).map(d => d.actual), [true, false], 'after Keep only the first is placed');
    assert.ok(top.projection.filter(d => !d.you).every(d => !d.actual), 'with nobody marked, every other seat is projected');
  }
});

test('a first pick is its own corner plus the projected second, and its projection shows exactly that', () => {
  for (const [seed, seat] of [[2, 1], [7, 2], [11, 3], [4, 4]]) {
    const b = generateBoard({ seed }), s = S({ seat }), opp = before(b, s);
    for (const r of rankLookahead(b, s, { me: [], opp }).slice(0, 5)) {
      assert.equal(cents(r.score), cents(r.own) + cents(r.second.score));
      assert.deepEqual(r.projection.filter(d => d.you).map(d => d.id), [r.id, r.second.id], 'the You rows are the recommendation');
      assert.equal(r.parts.find(p => p.k === 'outlook').v, r.second.score);
      assert.equal(cents(r.score), refOpening(b, s, r.id, r.second.id, r.projection.map(d => d.id)));
      // Every other seat's projected pick is the classic model's top for that seat at that moment. Seats that pick
      // between my two settlements cannot see my second one yet, so it only counts from its own turn onward.
      const occupied = [r.id, ...opp], firsts = {};
      for (const d of r.projection) {
        if (!d.you && !d.actual) {
          const mine = d.round === 2 ? [firsts[d.seat]] : [];
          assert.equal(d.id, rankSpots(b, { players: 4, seat: d.seat, cak: false }, { mine, occupied })[0].id, `seat ${d.seat} round ${d.round}`);
        }
        if (d.round === 1) firsts[d.seat] = d.id;
        if (!occupied.includes(d.id)) occupied.push(d.id);
      }
    }
  }
});

test('the second-pick ranking values the whole opening with the first settlement in place', () => {
  const b = generateBoard({ seed: 9 }), s = S({ seat: 2 });
  const draft = simulateDraft(b, s), first = draft.find(d => d.you).id;
  const opp = draft.slice(0, 2 * 4 - 2).filter(d => !d.you).map(d => d.id);
  const la = rankLookahead(b, s, { me: [first], opp });
  const ref = best(refSeconds(b, s, first, [first, ...opp]));
  assert.deepEqual([la[0].id, cents(la[0].score)], [ref.id, ref.cents]);
  assert.equal(cents(la[0].score), cents(la[0].first.score) + cents(la[0].own));
  assert.equal(la[0].parts.find(p => p.k === 'first').v, la[0].first.score);
  assert.equal(la[0].parts.some(p => p.k === 'outlook'), false, 'no outlook once the first settlement is down');
  assert.deepEqual(rankLookahead(b, s, { me: [first, la[0].id], opp }), [], 'nothing to rank once both are down');
});

// The full measurement lives in bench/lookahead-diagnostics.mjs; this keeps a deterministic sample.
test('production stays first: the look-ahead pick is within 4 raw pips of the board max for seat 1, within 6 of the classic top for any seat', () => {
  for (let seed = 1; seed <= 40; seed++) for (const setup of ['base', 'ext56']) {
    const players = setup === 'base' ? 4 : 6, b = generateBoard({ seed, setup });
    for (let seat = 1; seat <= players; seat += players - 1) {
      const s = S({ players, seat }), opp = before(b, s);
      const classic = rankSpots(b, s, { mine: [], occupied: opp }), la = rankLookahead(b, s, { me: [], opp });
      if (seat === 1) assert.ok(la[0].pips >= Math.max(...classic.map(x => x.pips)) - 4, `seed ${seed} ${setup}: ${la[0].pips} pips`);
      assert.ok(la[0].pips >= classic[0].pips - 6, `seed ${seed} ${setup} seat ${seat}: ${la[0].pips} vs ${classic[0].pips}`);
    }
  }
});

// Starting roads (R13) in look-ahead mode take the look-ahead's projection, like the map badges: the suggested side and
// the grade of a road you place judge the same projected opening.
test('road advice and road grades follow the look-ahead projection and agree with each other', () => {
  let roads = 0, differ = 0;
  for (let seed = 1; seed <= 60; seed++) for (const seat of [1, 2, 3, 4]) {
    const b = generateBoard({ seed }), s = S({ seat }), opp = before(b, s);
    const top = rankLookahead(b, s, { me: [], opp })[0];
    const context = { mine: [], occupied: opp, projection: projectionFor(b, s, { me: [], opp }, top.id) };
    const hint = suggestRoad(b, s, top.id, context);
    if (!hint) continue;
    roads++;
    assert.equal(gradeRoad(b, s, top.id, hint.edge, context).tier, 'great', `seed ${seed} seat ${seat}: the suggested side grades Great with the same projection`);
    const others = context.projection.filter(d => !d.you && !d.actual).map(d => d.id);
    if (!/contested/.test(hint.text)) assert.ok(legalVertices(b.graph, [...opp, top.id, ...others]).includes(hint.target.id), `seed ${seed} seat ${seat}: the target survives the projection`);
    if (hint.edge !== suggestRoad(b, s, top.id, { mine: [], occupied: opp }).edge) differ++;
  }
  assert.ok(roads > 200);
  assert.ok(differ > 0, 'the look-ahead projection changes some road advice, so this test is not vacuous');
});

test('deterministic, and inputs are never modified', () => {
  const b = generateBoard({ seed: 12 }), s = Object.freeze(S({ seat: 3 }));
  const opp = Object.freeze(before(b, s));
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const frozen = deepFreeze(generateBoard({ seed: 12 }));
  const one = rankLookahead(frozen, s, { me: Object.freeze([]), opp });
  const two = rankLookahead(b, s, { me: [], opp: [...opp] });
  assert.deepEqual(one, two);
});

test('a reflected board gets the same look-ahead values at the mirrored corners', () => {
  const b = generateBoard({ seed: 21 }), g = b.graph, centerY = g.hexes.reduce((sum, h) => sum + h.y, 0) / g.hexes.length;
  const reflect = list => list.map(h => list.find(o => Math.abs(o.x - h.x) < 1e-8 && Math.abs(o.y - (2 * centerY - h.y)) < 1e-8).id);
  const hexMap = reflect(g.hexes), vertexMap = reflect(g.vertices);
  const hexes = g.hexes.map(() => null);
  for (const h of b.hexes) hexes[hexMap[h.id]] = { resource: h.resource, number: h.number };
  const harbors = Object.fromEntries(Object.entries(b.harbors).map(([id, type]) => {
    const ends = g.edges[id].v.map(v => vertexMap[v]);
    return [g.edges.find(e => ends.every(v => e.v.includes(v))).id, type];
  }));
  const m = boardFrom({ setup: 'base', hexes, harbors });
  for (const seat of [1, 4]) {
    const s = S({ seat }), opp = before(b, s);
    const values = new Map(rankLookahead(b, s, { me: [], opp }).map(r => [vertexMap[r.id], r.score]));
    const mirrored = rankLookahead(m, s, { me: [], opp: opp.map(v => vertexMap[v]) });
    for (const r of mirrored) assert.equal(r.score, values.get(r.id), `corner ${r.id}`);
    // The best value is the same; with exact ties the chosen id may differ, so compare the tied set.
    const top = list => new Set(list.filter(x => x.score === list[0].score).map(x => x.id));
    assert.deepEqual(top(mirrored), new Set([...top(rankLookahead(b, s, { me: [], opp }))].map(v => vertexMap[v])));
  }
});

test('skipping the sentences never changes a value: explain:false gives the same ids, scores and part values', () => {
  for (const [seed, setup, players] of [[5, 'base', 4], [8, 'ext56', 6]]) {
    const b = generateBoard({ seed, setup });
    for (const cak of [false, true]) {
      const s = S({ players, seat: 2, cak }), draft = simulateDraft(b, s);
      const occupied = draft.slice(0, 5).map(d => d.id), mine = draft.slice(0, 5).filter(d => d.you).map(d => d.id);
      const said = rankSpots(b, s, { mine, occupied }), quiet = rankSpots(b, s, { mine, occupied, explain: false });
      assert.deepEqual(quiet.map(r => [r.id, r.score, r.parts.map(p => [p.k, p.v])]), said.map(r => [r.id, r.score, r.parts.map(p => [p.k, p.v])]));
      assert.ok(said.every(r => r.parts.every(p => typeof p.text === 'string' && p.text.length > 0)));
      const first = mine[0] ?? draft.find(d => d.you).id;
      const loud = rankSecond(b, s, first, [first, ...occupied.filter(x => x !== first)], { all: true }), hushed = rankSecond(b, s, first, [first, ...occupied.filter(x => x !== first)], { all: true, explain: false });
      assert.deepEqual(hushed.map(r => [r.id, r.score, r.own]), loud.map(r => [r.id, r.score, r.own]));
    }
  }
});

test('compareLookahead puts the second-settlement outlook first, then the corners themselves', () => {
  const b = generateBoard({ seed: 3 }), s = S({ seat: 4 }), opp = before(b, s);
  const la = rankLookahead(b, s, { me: [], opp });
  const pick = la.find(x => x.id === 41);
  const lines = compareLookahead(la[0], pick);
  assert.match(lines[0], /^Second-settlement outlook: \d+\.\d\d for #1 versus \d+\.\d\d for your pick\.$/);
  assert.deepEqual(compareLookahead(la[0], la[0]), []);
  assert.equal(POLICY, 'draft-aware-2026-10-12');
});

test('a repeated position is answered from memory, and projectionFor matches the ranking it came from', () => {
  const b = generateBoard({ seed: 14 }), s = S({ seat: 2 }), opp = before(b, s);
  const one = rankLookahead(b, s, { me: [], opp });
  assert.equal(rankLookahead(b, s, { me: [], opp: [...opp] }), one, 'same position, same array');
  assert.notEqual(rankLookahead(b, S({ seat: 2, plan: 'road' }), { me: [], opp }), one, 'a different plan is a different position');
  for (const r of one.slice(0, 3)) assert.deepEqual(projectionFor(b, s, { me: [], opp }, r.id), r.projection);
  // The on-screen second-pick ranking values every open corner (the pruning is only used inside first picks), so any
  // pick can be graded, and each one's projection has both of my settlements in place.
  const first = one[0].id;
  const shown = rankLookahead(b, s, { me: [first], opp }), atTurn = [first, ...opp, ...simulateDraft(b, s, { me: [first], opp }).filter((d, slot) => !d.actual && slot < 2 * 4 - 2).map(d => d.id)];
  const pruned = rankSecond(b, s, first, atTurn);
  assert.ok(pruned.length < shown.length, 'the pruned search skips corners the shown ranking includes');
  assert.deepEqual(shown.map(r => r.id).sort((x, y) => x - y), legalVertices(b.graph, atTurn).sort((x, y) => x - y));
  const last = shown[shown.length - 1];
  assert.deepEqual(projectionFor(b, s, { me: [first], opp }, last.id).filter(d => d.you).map(d => d.id), [first, last.id]);
});

test('look-ahead grades speak of openings; classic grades keep their corner wording', () => {
  const b = generateBoard({ seed: 3 }), s = S({ seat: 4 }), opp = before(b, s);
  const la = rankLookahead(b, s, { me: [], opp }), classic = rankSpots(b, s, { mine: [], occupied: opp });
  assert.equal(grade(la[0], la, 4, 'opening').why, 'the best opening on the board.');
  assert.equal(grade(la[2], la, 4, 'opening').why, 'one of the top 4 openings.');
  assert.match(grade(la[20], la, 4, 'opening').why, /% of the best opening\.$/);
  assert.equal(grade(classic[0], classic, 4).why, 'the best open corner on the board.');
  assert.match(grade(classic[20], classic, 4).why, /% of the best corner\.$/);
});

test('other opponent styles are report-only: the look-ahead ranking is the same before and after a stability check', () => {
  const b = generateBoard({ seed: 6 }), s = S({ seat: 1 });
  const first = rankLookahead(b, s, { me: [], opp: [] }), snapshot = JSON.stringify(first);
  const check = stability(b, s, { me: [], opp: [] }, first[0].id);
  assert.deepEqual(check.map(c => c.style), OPPONENT_STYLES);
  for (const c of check) assert.ok(c.top && c.rank >= 1 && c.rank <= c.total);
  assert.equal(rankLookahead(b, s, { me: [], opp: [] }), first, 'the classic-opponent ranking is still the remembered one');
  assert.equal(JSON.stringify(first), snapshot, 'and it was not modified');
  assert.throws(() => rankLookahead(b, s, { me: [], opp: [] }, { style: 'psychic' }), /Unknown opponent style/);
  assert.throws(() => rankLookahead(b, s, { me: [], opp: [] }, { style: 'constructor' }), /Unknown opponent style/);
});

test('the most-pips style gives every unplaced seat the open corner with the most pips; the coverage style adds new resources first', () => {
  const b = generateBoard({ seed: 6 }), s = S({ seat: 2 }), first = rankLookahead(b, s, { me: [], opp: [] })[0].id;
  const produced = ids => new Set(ids.flatMap(v => b.graph.vertices[v].hexes.filter(h => b.hexes[h].number).map(h => b.hexes[h].resource)));
  for (const style of ['pips', 'coverage']) {
    const occupied = [first], firsts = {};
    for (const d of projectDraft(b, s, { me: [first] }, null, style)) {
      if (!d.you && !d.actual) {
        const mine = d.round === 2 ? [firsts[d.seat]] : [], have = produced(mine);
        const key = v => style === 'pips' ? [pipsAt(b, v), 0] : [[...produced([v])].filter(r => !have.has(r)).length, pipsAt(b, v)];
        const want = legalVertices(b.graph, occupied).reduce((a, v) => { const k = key(v), ka = key(a); return k[0] > ka[0] || (k[0] === ka[0] && (k[1] > ka[1] || (k[1] === ka[1] && v < a))) ? v : a; });
        assert.equal(d.id, want, `${style}: seat ${d.seat} round ${d.round}`);
      }
      if (d.round === 1) firsts[d.seat] = d.id;
      if (!occupied.includes(d.id)) occupied.push(d.id);
    }
  }
});

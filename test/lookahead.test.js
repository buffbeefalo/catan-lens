// The look-ahead policy (draft-aware-2026-10-12, R14). Correctness is checked against a slow, independent reference
// that enumerates every first and second settlement with the classic functions; playing strength is a separate
// question for the benchmark, never assumed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, boardFrom, PIPS } from '../public/board.js';
import { rankSpots, scoreVertex, simulateDraft, grade } from '../public/score.js';
import { legalVertices } from '../public/geometry.js';
import { POLICY, projectDraft, projectionFor, rankFirst, rankSecond, rankLookahead, compareLookahead } from '../public/lookahead.js';

const S = (o = {}) => ({ players: 4, seat: 1, cak: false, ...o });
const cents = x => Math.round(x * 100);
const pipsAt = (b, v) => b.graph.vertices[v].hexes.reduce((s, h) => s + (b.hexes[h].number ? PIPS[b.hexes[h].number] : 0), 0);
// Earlier seats' first settlements, placed as the projected draft has them (the position you face at your turn).
const before = (b, s) => simulateDraft(b, s).filter(d => d.round === 1 && d.seat < s.seat).map(d => d.id);

// ---- Independent reference ----------------------------------------------------------------------------------
// R8 targets recomputed from the distance rule: the best corner two roads away that is open once `vid` is taken,
// and the best one still open at the end of setup.
function refRoom(b, vid, occupied, end) {
  const now = new Set(legalVertices(b.graph, [...occupied, vid])), last = new Set(legalVertices(b.graph, end));
  let classic = 0, surviving = 0;
  for (const n of b.graph.vertices[vid].neighbors) for (const t of b.graph.vertices[n].neighbors) {
    if (t === vid || !now.has(t)) continue;
    classic = Math.max(classic, pipsAt(b, t));
    if (last.has(t)) surviving = Math.max(surviving, pipsAt(b, t));
  }
  return { classic, surviving };
}
const best = list => list.reduce((a, x) => (!a || x.cents > a.cents || (x.cents === a.cents && (x.pips > a.pips || (x.pips === a.pips && x.id < a.id))) ? x : a), null);
// Every legal second settlement, unpruned: classic score with R8 replaced by its surviving value.
function refSeconds(b, s, first, atSecond) {
  const opp = atSecond.filter(x => x !== first);
  return legalVertices(b.graph, atSecond).map(id => {
    const c = scoreVertex(b, s, id, { mine: [first], occupied: atSecond });
    const end = simulateDraft(b, s, { me: [first, id], opp }).map(d => d.id);
    const room = refRoom(b, id, atSecond, end);
    return { id, pips: c.pips, cents: cents(c.score) - 10 * room.classic + 10 * room.surviving };
  });
}
// Every legal first settlement, each followed by the second the look-ahead's own second-pick rule would choose.
function refFirsts(b, s, opp) {
  const mySecondSlot = 2 * s.players - s.seat;
  return legalVertices(b.graph, opp).map(id => {
    const draft = simulateDraft(b, s, { me: [id], opp });
    const projected = draft.filter((d, slot) => !d.actual && slot < mySecondSlot).map(d => d.id);
    const second = best(refSeconds(b, s, id, [id, ...opp, ...projected]));
    const end = simulateDraft(b, s, { me: second ? [id, second.id] : [id], opp: [...opp, ...projected] }).map(d => d.id);
    const c = scoreVertex(b, s, id, { mine: [], occupied: opp });
    const room = refRoom(b, id, opp, end);
    const own = cents(c.score) - 10 * room.classic + 10 * room.surviving;
    return { id, pips: c.pips, cents: own + (second ? second.cents : 0), second: second?.id ?? null };
  });
}

// ---- Tests ------------------------------------------------------------------------------------------------------
test('the projection is the classic draft: same order, consumption of placed pieces and picks (no self-recursion)', () => {
  let states = 0;
  for (const players of [3, 4, 5, 6]) for (let seed = 1; seed <= 4; seed++) {
    const b = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed });
    for (let seat = 1; seat <= players; seat++) for (const cak of [false, true]) {
      const s = { players, seat, cak }, full = simulateDraft(b, s);
      for (let k = 0; k <= full.length; k += 3) {
        const me = full.slice(0, k).filter(d => d.you).map(d => d.id), opp = full.slice(0, k).filter(d => !d.you).map(d => d.id);
        assert.deepEqual(projectDraft(b, s, { me, opp }), simulateDraft(b, s, { me, opp }));
        states++;
      }
    }
  }
  assert.ok(states > 300);
});

test('first-pick ranking matches the exhaustive reference exactly, for every seat at a 4-player table', () => {
  for (const [seed, seat] of [[3, 1], [3, 2], [5, 3], [3, 4]]) {
    const b = generateBoard({ seed }), s = S({ seat }), opp = before(b, s);
    const ours = rankFirst(b, s, { opp }), ref = refFirsts(b, s, opp);
    const order = list => list.slice().sort((x, y) => y.cents - x.cents || y.pips - x.pips || x.id - y.id).map(x => [x.id, x.cents, x.second]);
    assert.deepEqual(ours.map(x => [x.id, cents(x.score), x.second?.id ?? null]), order(ref), `seed ${seed} seat ${seat}`);
  }
});

test('second-pick pruning is exact: the pruned best equals the unpruned best on 70 positions', () => {
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

test('room to grow counts only a corner still open when setup ends, and says so', () => {
  const b = generateBoard({ seed: 1 }), s = S();
  const c = rankLookahead(b, s, { me: [], opp: [] }).find(x => x.id === 33);
  const classic = scoreVertex(b, s, 33, { mine: [], occupied: [] });
  assert.deepEqual([c.room.classic.pips, c.room.surviving.pips], [11, 6], 'the 11-pip target is taken in the projection; a 6-pip one survives');
  assert.equal(cents(classic.score) - cents(c.own), 50, 'R8 drops from 1.10 to 0.60');
  const part = c.parts.find(p => p.k === 'expansion');
  assert.equal(part.v, 0.6);
  assert.match(part.text, /^Room to grow after setup is thin: .*only 6 pips\.$/);
  // Seed 4: corner 32's only targets (the best is a 12-pip corner) are all taken or blocked in the projection.
  const b4 = generateBoard({ seed: 4 });
  const lost = rankLookahead(b4, s, { me: [], opp: [] }).find(x => x.id === 32);
  assert.deepEqual([lost.room.classic.pips, lost.room.surviving], [12, null]);
  assert.equal(cents(scoreVertex(b4, s, 32, { mine: [], occupied: [] }).score) - cents(lost.own), 120, 'the whole 1.20 R8 credit goes');
  assert.equal(lost.parts.find(p => p.k === 'expansion').v, 0);
  assert.match(lost.parts.find(p => p.k === 'expansion').text, /takes or blocks every one of them, so this adds nothing\.$/);
});

test('a first pick is its own corner plus the projected second, and its projection shows exactly that', () => {
  for (const [seed, seat] of [[2, 1], [7, 2], [11, 3], [4, 4]]) {
    const b = generateBoard({ seed }), s = S({ seat }), opp = before(b, s);
    for (const r of rankLookahead(b, s, { me: [], opp }).slice(0, 5)) {
      assert.equal(cents(r.score), cents(r.own) + cents(r.second.score));
      assert.deepEqual(r.projection.filter(d => d.you).map(d => d.id), [r.id, r.second.id], 'the You rows are the recommendation');
      assert.equal(r.parts.find(p => p.k === 'outlook').v, r.second.score);
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

test('the second-pick ranking is the classic second score with surviving room to grow', () => {
  const b = generateBoard({ seed: 9 }), s = S({ seat: 2 });
  const draft = simulateDraft(b, s), first = draft.find(d => d.you).id;
  const opp = draft.slice(0, 2 * 4 - 2).filter(d => !d.you).map(d => d.id);
  const la = rankLookahead(b, s, { me: [first], opp });
  const ref = best(refSeconds(b, s, first, [first, ...opp]));
  assert.deepEqual([la[0].id, cents(la[0].score)], [ref.id, ref.cents]);
  assert.equal(la[0].parts.some(p => p.k === 'outlook'), false, 'no outlook once the first settlement is down');
  assert.deepEqual(rankLookahead(b, s, { me: [first, la[0].id], opp }), [], 'nothing to rank once both are down');
});

// The full 400-board, every-seat measurement lives in bench/draft-diagnostics.mjs; this keeps a deterministic sample.
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
  const shown = rankLookahead(b, s, { me: [first], opp }), pruned = rankSecond(b, s, first, [first, ...opp]);
  assert.ok(pruned.length < shown.length, 'the pruned search skips corners the shown ranking includes');
  assert.deepEqual(shown.map(r => r.id).sort((x, y) => x - y), legalVertices(b.graph, [first, ...opp]).sort((x, y) => x - y));
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

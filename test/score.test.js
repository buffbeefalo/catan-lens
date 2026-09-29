import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, PIPS } from '../public/board.js';
import { rankSpots, scoreVertex, boardFacts, planFor, compare, grade, simulateDraft, suggestRoad } from '../public/score.js';
import { legalVertices } from '../public/geometry.js';

const S = (o = {}) => ({ players: 4, seat: 1, cak: false, ...o });

test('plan follows seat and Cities & Knights (R10/R11)', () => {
  assert.equal(planFor(S({ seat: 1 })), 'ows');
  assert.equal(planFor(S({ seat: 2 })), 'ows');
  assert.equal(planFor(S({ seat: 3 })), 'road');
  assert.equal(planFor(S({ players: 6, seat: 3 })), 'ows');
  assert.equal(planFor(S({ seat: 4, cak: true })), 'cak');
});

test('ranking covers every legal corner, best-first, and every entry explains its production (R1)', () => {
  const b = generateBoard({ seed: 3 });
  const r = rankSpots(b, S());
  assert.equal(r.length, 54);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  for (const x of r) assert.match(x.parts[0].text, /pips of production/);
  assert.match(r[0].parts[0].text, /the most on the board|within a pip/);
});

test('more pips wins when everything else is equal (R1)', () => {
  const b = generateBoard({ seed: 11 });
  const r = rankSpots(b, S());
  const top = r[0];
  const worst = r[r.length - 1];
  assert.ok(top.pips > worst.pips);
});

test('scarcity scales a resource up when the board is short of it (R3)', () => {
  const b = generateBoard({ seed: 5 });
  const f = boardFacts(b);
  const tiles = { wood: 4, brick: 3, wheat: 4, sheep: 4, ore: 3 };
  const perTile = Object.entries(f.pips).map(([r, p]) => [r, p / tiles[r]]);
  const shortest = perTile.sort((a, c) => a[1] - c[1])[0][0];
  const longest = perTile.sort((a, c) => c[1] - a[1])[0][0];
  assert.ok(f.scarcity[shortest] >= f.scarcity[longest]);
  assert.ok(f.scarcity[shortest] <= 1.3 && f.scarcity[longest] >= 0.8);
});

test('wood+brick and wheat+ore pairs add their bonus and a sentence (R4)', () => {
  const b = generateBoard({ seed: 8 });
  const r = rankSpots(b, S());
  const wb = r.find(x => x.prod.wood && x.prod.brick);
  assert.ok(wb.parts.some(p => p.k === 'pair' && /Wood and brick/.test(p.text)));
  const wo = r.find(x => x.prod.wheat && x.prod.ore);
  assert.ok(wo.parts.some(p => p.k === 'pair' && /city-building/.test(p.text)));
});

test('no robber term exists anywhere in the parts (R5)', () => {
  const b = generateBoard({ seed: 8 });
  for (const x of rankSpots(b, S())) assert.ok(!x.parts.some(p => /robber/i.test(p.text)));
});

test('second settlement: repeating a held number costs 0.75 and covering a missing resource pays (R6/R9)', () => {
  const b = generateBoard({ seed: 21 });
  const first = rankSpots(b, S())[0];
  const occupied = [first.id];
  const r2 = rankSpots(b, S(), { mine: occupied, occupied });
  assert.equal(r2.length, 54 - 1 - b.graph.vertices[first.id].neighbors.length);
  const rep = r2.find(x => x.numbers.some(n => first.numbers.includes(n)));
  const pen = rep.parts.filter(p => p.k === 'repeat').reduce((s, p) => s + p.v, 0);
  assert.ok(pen <= -0.75);
  const missing = ['wood', 'brick', 'wheat', 'sheep', 'ore'].filter(r => !first.prod[r]);
  const cov = r2.find(x => x.resources.some(r => missing.includes(r)));
  if (cov) {
    assert.ok(cov.parts.some(p => p.k === 'complement'));
    assert.deepEqual(cov.startingCards.map(c => c.split(' ')[1]), cov.resources);   // one entry per resource, counted per hex ('2 wheat')
    assert.ok(cov.startingCards.every(c => /^\d+ \w+$/.test(c)));
  }
});

test('ports: 3:1 on the corner beats the same corner without it; far port is half (R7)', () => {
  const b = generateBoard({ seed: 13 });
  const eid = Number(Object.keys(b.harbors).find(e => b.harbors[e] === '3:1'));
  const [va] = b.graph.edges[eid].v;
  const withPort = scoreVertex(b, S(), va);
  const p = withPort.parts.find(x => x.k === 'port');
  assert.ok(p && p.v === 1.0 && /Sits on the 3:1/.test(p.text));
  const far = b.graph.vertices[va].neighbors.find(n => !b.graph.vertices[n].edges.some(e => b.harbors[e] !== undefined));
  if (far !== undefined) {
    const fp = scoreVertex(b, S(), far).parts.find(x => x.k === 'port');
    assert.ok(fp && fp.v <= 0.75 && /One road from/.test(fp.text));
  }
});

test('Cities & Knights: ore weighs more, ports weigh less, commodity hexes noted (R11)', () => {
  const b = generateBoard({ seed: 17 });
  const ore = b.graph.vertices.find(v => v.hexes.some(h => b.hexes[h].resource === 'ore' && b.hexes[h].number)).id;
  const base = scoreVertex(b, S(), ore), cak = scoreVertex(b, S({ cak: true }), ore);
  assert.ok(cak.parts.some(p => p.k === 'commodity'));
  const bp = base.parts.find(p => p.k === 'port'), cp = cak.parts.find(p => p.k === 'port');
  if (bp && cp) assert.ok(cp.v < bp.v);
});

test('compare() names what the best corner has that the pick lacks', () => {
  const b = generateBoard({ seed: 2 });
  const r = rankSpots(b, S());
  assert.deepEqual(compare(r[0], r[0]), []);
  const diff = compare(r[0], r[r.length - 1]);
  assert.ok(diff.length >= 1 && /pips versus your/.test(diff[0]));
});

test('pip table is the two-dice distribution', () => {
  assert.equal(PIPS[6], 5); assert.equal(PIPS[2], 1); assert.equal(PIPS[9], 4);
});

test('bonuses never outrun production: the top corner is within 4 pips of the board max on 200 seeds (R1)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const setup of ['base', 'ext56']) {
      const b = generateBoard({ seed, setup });
      const r = rankSpots(b, S({ players: setup === 'base' ? 4 : 6 }));
      const max = Math.max(...r.map(x => x.pips));
      assert.ok(r[0].pips >= max - 4, `seed ${seed} ${setup}: top has ${r[0].pips} pips, max ${max}`);
    }
  }
});

test('second-settlement mode keeps the same bound: top corner within 4 raw pips of the max on 400 boards (R1/R9)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const setup of ['base', 'ext56']) {
      const b = generateBoard({ seed, setup });
      const s = S({ players: setup === 'base' ? 4 : 6 });
      const first = rankSpots(b, s)[0];
      const r2 = rankSpots(b, s, { mine: [first.id], occupied: [first.id] });
      const max = Math.max(...r2.map(x => x.pips));
      assert.ok(r2[0].pips >= max - 4, `seed ${seed} ${setup}: second top has ${r2[0].pips} pips, max ${max}`);
    }
  }
});

test('port bonus is the single best port at the corner, never stacked (R7)', () => {
  const b = generateBoard({ seed: 13 });
  for (const x of rankSpots(b, S())) assert.ok(x.parts.filter(p => p.k === 'port').length <= 1);
});

test('grade: rank, percentage of the best corner and a tier that depends on player count', () => {
  const b = generateBoard({ seed: 3 });
  const r = rankSpots(b, S());
  const g1 = grade(r[0], r, 4);
  assert.deepEqual([g1.rank, g1.total, g1.pct, g1.tier], [1, 54, 100, 'great']);
  const g4 = grade(r[3], r, 4);
  assert.equal(g4.rank, 4); assert.equal(g4.tier, 'good');          // one of the 4 corners a 4-player table fights over
  assert.equal(grade(r[3], r, 3).tier === 'good', false);            // not in the top 3 of a 3-player game
  assert.equal(grade(r[5], r, 6).tier, 'good');                      // but #6 is fine at a 6-player table
  const worst = grade(r[r.length - 1], r, 4);
  assert.equal(worst.rank, 54); assert.ok(worst.pct < 90); assert.equal(worst.tier, 'weak');
  for (let i = 1; i < r.length; i++) assert.ok(grade(r[i], r, 4).pct <= grade(r[i - 1], r, 4).pct);
  assert.match(g1.label, /Great/); assert.match(worst.label, /Weak/);
});

test('grade: fair sits between good and weak by score share', () => {
  const b = generateBoard({ seed: 3 });
  const r = rankSpots(b, S());
  const fair = r.find((x, i) => i >= 4 && x.score / r[0].score >= 0.9);
  if (fair) assert.equal(grade(fair, r, 4).tier, 'fair');
  const weak = r.find((x, i) => i >= 4 && x.score / r[0].score < 0.9);
  assert.equal(grade(weak, r, 4).tier, 'weak');
});

test('draft projection: snake order, every pick legal, each simulated pick is the best legal corner for that seat', () => {
  const b = generateBoard({ seed: 3 });
  for (const players of [3, 4, 6]) {
    const bb = players >= 5 ? generateBoard({ setup: 'ext56', seed: 3 }) : b;
    const d = simulateDraft(bb, S({ players, seat: 1 }));
    assert.equal(d.length, players * 2);
    assert.deepEqual(d.map(x => x.seat), [...Array.from({ length: players }, (_, i) => i + 1), ...Array.from({ length: players }, (_, i) => players - i)]);
    assert.deepEqual(d.map(x => x.round), [...Array(players).fill(1), ...Array(players).fill(2)]);
    const ids = d.map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, 'distinct corners');
    // legality: every later pick was legal given the earlier ones
    for (let i = 0; i < ids.length; i++) assert.ok(legalVertices(bb.graph, ids.slice(0, i)).includes(ids[i]), `pick ${i} legal`);
    assert.ok(d.every(x => x.actual === false));
    assert.equal(d[0].id, rankSpots(bb, S({ players, seat: 1 }))[0].id, 'seat 1 takes the #1 corner');
    // seat 2's first pick is the best legal corner under seat 2's own plan once seat 1's corner is down
    assert.equal(d[1].id, rankSpots(bb, S({ players, seat: 2 }), { occupied: [d[0].id] })[0].id);
    // the last seat's second pick complements its first
    const last = d[players - 1], second = d[players];
    assert.equal(second.seat, last.seat);
    assert.equal(second.id, rankSpots(bb, S({ players, seat: last.seat }), { mine: [last.id], occupied: ids.slice(0, players) })[0].id);
  }
});

test('draft projection: placed pieces fill their seats in turn order and are never simulated over', () => {
  const b = generateBoard({ seed: 3 });
  const free = rankSpots(b, S());
  const me1 = free[0].id;                                  // I am seat 2; seat 1 already took a corner (opp mark)
  const opp1 = legalVertices(b.graph, [me1])[0];
  const d = simulateDraft(b, S({ players: 4, seat: 2 }), { me: [me1], opp: [opp1] });
  assert.deepEqual(d.slice(0, 2).map(x => [x.seat, x.id, x.actual, x.you]), [[1, opp1, true, false], [2, me1, true, true]]);
  assert.ok(d.slice(2).every(x => !x.actual));
  assert.ok(!d.slice(2).some(x => x.id === me1 || x.id === opp1));
  // my second slot (round 2, seat 2) is simulated and complements my first
  const mine2 = d.find(x => x.seat === 2 && x.round === 2);
  assert.equal(mine2.actual, false);
  const before = d.slice(0, d.indexOf(mine2)).map(x => x.id);
  assert.equal(mine2.id, rankSpots(b, S({ players: 4, seat: 2 }), { mine: [me1], occupied: before })[0].id);
  // an opponent mark that comes before my first placement still lands on seat 1 when I am seat 1
  const d2 = simulateDraft(b, S({ players: 3, seat: 1 }), { me: [], opp: [opp1] });
  assert.equal(d2[0].seat, 1); assert.equal(d2[0].actual, false); assert.notEqual(d2[0].id, opp1, 'my simulated pick avoids the marked corner');
  assert.deepEqual([d2[1].seat, d2[1].id, d2[1].actual], [2, opp1, true]);
});

test('R6 repeats: a duplicate inside my own first settlement is not charged to every second-settlement corner (sweep finding)', () => {
  // find an ext56 board where the best first corner touches two hexes with the same number
  for (let seed = 1; seed <= 60; seed++) {
    const b = generateBoard({ seed, setup: 'ext56' });
    const first = rankSpots(b, S({ players: 6 })).find(x => new Set(x.numbers).size < x.numbers.length);
    if (!first) continue;
    const r2 = rankSpots(b, S({ players: 6 }), { mine: [first.id], occupied: [first.id] });
    const clean = r2.filter(x => !x.numbers.some(n => first.numbers.includes(n)) && new Set(x.numbers).size === x.numbers.length);
    assert.ok(clean.length > 0);
    for (const x of clean) assert.ok(!x.parts.some(p => p.k === 'repeat'), `corner ${x.id} charged a repeat it does not have`);
    return;
  }
  assert.fail('no ext56 board with a doubled number in the top corner within 60 seeds');
});

test('compare(): never lists pips or a pair the pick already has as something it lacks (sweep finding)', () => {
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rankSpots(generateBoard({ seed }), S());
    for (const pick of r.slice(1, 8)) {
      const diff = compare(r[0], pick);
      if (pick.pips >= r[0].pips) assert.ok(!diff.some(d => /pips versus/.test(d)), `seed ${seed}: pip sentence against a pick with ${pick.pips} >= ${r[0].pips}`);
      for (const k of ['pair', 'port', 'expansion']) {
        const has = pick.parts.filter(p => p.k === k).reduce((s, p) => s + (p.v || 0), 0) > 0;
        const bestText = r[0].parts.find(p => p.k === k)?.text;
        if (has && bestText) assert.ok(!diff.includes(bestText), `seed ${seed}: told it lacks ${k} it has`);
      }
      checked++;
    }
  }
  assert.ok(checked > 200);
});

test('every scored component is listed: listed part values add up to the score (sweep finding on R8)', () => {
  for (let seed = 1; seed <= 30; seed++) for (const setup of ['base', 'ext56']) {
    const b = generateBoard({ seed, setup });
    for (const x of rankSpots(b, S({ players: setup === 'base' ? 4 : 6 }))) {
      const sum = x.parts.reduce((s, p) => s + (p.v || 0), 0);
      assert.ok(Math.abs(sum - x.score) < 0.02, `seed ${seed} ${setup} corner ${x.id}: parts ${sum} vs score ${x.score}`);
    }
  }
});

test('grade(): exact ties share rank 1 at 100%, and a pick outside the ranking is never a pass (sweep finding)', () => {
  const b = generateBoard({ seed: 3 });
  const r = rankSpots(b, S());
  const tied = { ...r[1], score: r[0].score };
  const rr = [r[0], tied, ...r.slice(2)];
  assert.deepEqual([grade(tied, rr, 4).rank, grade(tied, rr, 4).pct, grade(tied, rr, 4).tier], [1, 100, 'great']);
  const ghost = { ...r[0], id: 9999 };
  const g = grade(ghost, r, 4);
  assert.equal(g.rank, r.length + 1); assert.equal(g.tier, 'weak'); assert.equal(g.pct, 0);
});

test('R7: a port one road away is credited only if its far end can still be settled (sweep finding)', () => {
  let credited = 0, blocked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const b = generateBoard({ seed });
    for (const [eid] of Object.entries(b.harbors)) {
      const [a, c] = b.graph.edges[eid].v;
      for (const [near, far] of [[a, c], [c, a]]) {
        // a corner exactly one road from `near` that is not itself on the port edge
        const vid = b.graph.vertices[near].neighbors.find(n => n !== far && !b.graph.vertices[n].edges.some(e => b.harbors[e] !== undefined));
        if (vid === undefined) continue;
        const portEdgesNearby = new Set(b.graph.vertices[vid].neighbors.flatMap(n => b.graph.vertices[n].edges.filter(e => b.harbors[e] !== undefined)));
        if (portEdgesNearby.size !== 1) continue;   // a second port nearby could legitimately keep the credit
        const free = scoreVertex(b, S(), vid, { occupied: [] });
        const blocker = b.graph.vertices[far].neighbors.find(n => n !== near && n !== vid && !b.graph.vertices[vid].neighbors.includes(n));
        if (blocker === undefined) continue;
        const withBlock = scoreVertex(b, S(), vid, { occupied: [blocker] });
        const hasFar = x => x.parts.some(p => p.k === 'port' && /One road from/.test(p.text));
        if (hasFar(free)) { credited++; assert.ok(!hasFar(withBlock), `seed ${seed} corner ${vid}: far end ${far} blocked by ${blocker} but port still credited`); blocked++; }
      }
    }
  }
  assert.ok(credited > 10 && blocked > 10);
});

test('starting road points along an edge of the settlement toward the best legal corner two roads away (R13)', () => {
  for (const seed of [1, 7, 42, 99]) {
    const b = generateBoard({ seed });
    const best = rankSpots(b, S())[0];
    const r = suggestRoad(b, S(), best.id);
    assert.ok(r, 'a fresh board always has room');
    const e = b.graph.edges[r.edge];
    assert.ok(e.v.includes(best.id) && e.v.includes(r.via), 'the road edge joins the settlement to the via corner');
    assert.ok(b.graph.vertices[r.via].neighbors.includes(r.target.id), 'the target is one more road on');
    const projected = simulateDraft(b, S(), { me: [best.id] }).filter(d => !d.you && !d.actual).map(d => d.id);
    const after = new Set(legalVertices(b.graph, [best.id, ...projected]));
    assert.ok(after.has(r.target.id), 'the target stays legal once the settlement is down and the other seats have made their projected picks');
    // no other reachable corner that survives the projected draft scores higher than the chosen target
    const reach = new Set();
    for (const n of b.graph.vertices[best.id].neighbors) for (const nn of b.graph.vertices[n].neighbors) if (nn !== best.id && after.has(nn)) reach.add(nn);
    const scores = [...reach].map(id => scoreVertex(b, S(), id, { mine: [best.id], occupied: [best.id] }).score);
    assert.equal(r.target.score, Math.max(...scores));
    assert.match(r.text, /^Road: point it toward the \d+-pip corner/);
  }
});

test('starting road avoids a corner the other seats are projected to take before your next turn (R13)', () => {
  const b = generateBoard({ seed: 1 });   // seat 1's best corner is 43; the old road aimed at 33, seat 2's projected first pick
  const r = suggestRoad(b, S(), 43);
  const projected = simulateDraft(b, S(), { me: [43] }).filter(d => !d.you && !d.actual).map(d => d.id);
  assert.ok(projected.includes(33));
  assert.ok(!legalVertices(b.graph, [43, ...projected]).includes(33));
  assert.notEqual(r.target.id, 33);
  assert.ok(legalVertices(b.graph, [43, ...projected]).includes(r.target.id), 'the new target survives the projected draft');
  assert.match(r.text, /The \d+-pip corner .* is likely to be taken or blocked before your next turn/, 'the card says why the road skips the better-looking corner');
});

test('starting road for the last pick of the draft is unchanged: nobody places after it (R13)', () => {
  const b = generateBoard({ seed: 1 });
  const d = simulateDraft(b, S());
  const [first, second] = d.filter(x => x.you).map(x => x.id);   // seat 1 picks first and last
  const others = d.filter(x => !x.you).map(x => x.id);
  const r = suggestRoad(b, S(), second, { mine: [first], occupied: [first, ...others] });
  const after = new Set(legalVertices(b.graph, [first, ...others, second]));
  const reach = new Set();
  for (const n of b.graph.vertices[second].neighbors) if (!others.includes(n) && n !== first) for (const nn of b.graph.vertices[n].neighbors) if (nn !== second && after.has(nn)) reach.add(nn);
  const scores = [...reach].map(id => scoreVertex(b, S(), id, { mine: [first, second], occupied: [first, ...others, second] }).score);
  assert.equal(r.target.score, Math.max(...scores));
});

test('starting road is null when every corner two roads away is taken (R13 dead end)', () => {
  const b = generateBoard({ seed: 3 });
  const vid = 0;
  const twoAway = new Set();
  for (const n of b.graph.vertices[vid].neighbors) for (const nn of b.graph.vertices[n].neighbors) if (nn !== vid) twoAway.add(nn);
  assert.equal(suggestRoad(b, S(), vid, { occupied: [...twoAway] }), null);
  // and a road never points into an occupied neighbour
  const n0 = b.graph.vertices[vid].neighbors[0];
  const r = suggestRoad(b, S(), vid, { occupied: [n0] });
  if (r) assert.notEqual(r.via, n0);
});

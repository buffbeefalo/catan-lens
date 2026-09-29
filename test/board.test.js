import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, SETUPS, PIPS } from '../public/board.js';

function counts(arr) { return arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {}); }

for (const setup of ['base', 'ext56']) {
  test(`${setup}: tile, token and harbour distributions match the official box`, () => {
    const b = generateBoard({ setup, seed: 42 });
    assert.deepEqual(counts(b.hexes.map(h => h.resource)), SETUPS[setup].tiles);
    const nums = b.hexes.filter(h => h.resource !== 'desert').map(h => h.number);
    assert.deepEqual(counts(nums), counts(SETUPS[setup].tokens));
    for (const h of b.hexes) assert.equal(h.number === null, h.resource === 'desert');
    assert.deepEqual(counts(Object.values(b.harbors)).ore, 1);
    assert.equal(Object.keys(b.harbors).length, SETUPS[setup].harbors.length);
    const perim = new Set(b.graph.perimeter);
    for (const e of Object.keys(b.harbors)) assert.ok(perim.has(Number(e)), 'harbours sit on coastal edges');
  });

  test(`${setup}: harbours never share a corner`, () => {
    const b = generateBoard({ setup, seed: 7 });
    const seen = new Set();
    for (const eid of Object.keys(b.harbors)) for (const v of b.graph.edges[eid].v) { assert.ok(!seen.has(v)); seen.add(v); }
  });

  test(`${setup}: 6 and 8 never touch across 300 seeds (balanced default)`, () => {
    for (let seed = 1; seed <= 300; seed++) {
      const b = generateBoard({ setup, seed });
      const num = b.hexes.map(h => h.number);
      for (const e of b.graph.edges) {
        if (e.hexes.length !== 2) continue;
        const [p, q] = e.hexes.map(i => num[i]);
        assert.ok(!((p === 6 || p === 8) && (q === 6 || q === 8)), `seed ${seed}: reds touch on ${setup}`);
      }
    }
  });
}

test('same seed gives the same board, different seeds differ', () => {
  const a = generateBoard({ seed: 99 }), b = generateBoard({ seed: 99 }), c = generateBoard({ seed: 100 });
  assert.deepEqual(a.hexes.map(h => [h.resource, h.number]), b.hexes.map(h => [h.resource, h.number]));
  assert.notDeepEqual(a.hexes.map(h => [h.resource, h.number]), c.hexes.map(h => [h.resource, h.number]));
});

test('pips sum to 30 (36 two-dice outcomes minus the six ways to roll 7)', () => {
  assert.equal(Object.values(PIPS).reduce((s, x) => s + x, 0), 30);
});

test('balanced flag is measured from the board, and a forced exhaustion is reported, never mislabelled', () => {
  const ok = generateBoard({ seed: 5 });
  assert.equal(ok.balanced, true); assert.equal(ok.balanceFailed, false);
  // Force the exhaustion path: no spiral rotations, no shuffles. The fallback spiral may or may
  // not touch reds; whichever it is, the flags must tell the truth about it.
  const forced = generateBoard({ seed: 5, _spirals: 0, _tries: 0 });
  assert.equal(forced.balanceFailed, true);
  const num = forced.hexes.map(h => h.number);
  const touches = forced.graph.edges.some(e => e.hexes.length === 2 && [6, 8].includes(num[e.hexes[0]]) && [6, 8].includes(num[e.hexes[1]]));
  assert.equal(forced.balanced, !touches);
  // A found-unbalanced board (balanced: false requested) reports what it is, too.
  const loose = generateBoard({ seed: 5, balanced: false });
  const n2 = loose.hexes.map(h => h.number);
  const t2 = loose.graph.edges.some(e => e.hexes.length === 2 && [6, 8].includes(n2[e.hexes[0]]) && [6, 8].includes(n2[e.hexes[1]]));
  assert.equal(loose.balanced, !t2);
});

test('the number spiral is continuous: every step in spiral order moves to an adjacent hex (sweep finding, base board)', async () => {
  const { spiralOrderForTest } = await import('../public/board.js');
  const b = generateBoard({ seed: 1 });
  const nb = b.graph.hexes.map(() => new Set());
  for (const e of b.graph.edges) if (e.hexes.length === 2) { nb[e.hexes[0]].add(e.hexes[1]); nb[e.hexes[1]].add(e.hexes[0]); }
  for (let turn = 0; turn < 6; turn++) {
    const o = spiralOrderForTest(b.graph, turn);
    assert.equal(new Set(o).size, b.graph.hexes.length);
    for (let i = 1; i < o.length; i++) assert.ok(nb[o[i - 1]].has(o[i]), `turn ${turn}: step ${i} (${o[i - 1]} -> ${o[i]}) is not adjacent`);
  }
});

// ---- Your board: a hand-entered board (2026-09-15) ----------------------------------------
import { boardFrom, encodeBoard, decodeBoard, checkTiles, blankBoard } from '../public/board.js';

test('boardFrom: builds a scoreable board from hand-entered hexes and harbours; balance is measured, not assumed', () => {
  const gen = generateBoard({ setup: 'base', seed: 42 });
  const b = boardFrom({ setup: 'base', hexes: gen.hexes.map(h => ({ resource: h.resource, number: h.number })), harbors: gen.harbors });
  assert.equal(b.custom, true); assert.equal(b.seed, null); assert.equal(b.setup, 'base');
  assert.equal(b.hexes.length, gen.hexes.length); assert.deepEqual(b.hexes.map(h => [h.resource, h.number]), gen.hexes.map(h => [h.resource, h.number]));
  assert.deepEqual(b.harbors, gen.harbors); assert.equal(b.balanced, gen.balanced);
  // make 6 and 8 touch: balance flips to false
  const nb = gen.graph.edges.find(e => e.hexes.length === 2).hexes;
  const hx = gen.hexes.map(h => ({ resource: h.resource === 'desert' ? 'wood' : h.resource, number: h.number || 3 }));
  hx[nb[0]].number = 6; hx[nb[1]].number = 8;
  assert.equal(boardFrom({ setup: 'base', hexes: hx, harbors: {} }).balanced, false);
  // blank hexes (not yet painted) and deserts never carry a number
  const blank = blankBoard('ext56');
  assert.equal(blank.hexes.length, 30); assert.ok(blank.hexes.every(h => h.resource === 'blank' && h.number === null)); assert.deepEqual(blank.harbors, {});
  const bad = boardFrom({ setup: 'base', hexes: gen.hexes.map(h => ({ resource: 'blank', number: 8 })), harbors: {} });
  assert.ok(bad.hexes.every(h => h.number === null));
});

test('encodeBoard / decodeBoard: round-trips through the link; garbage decodes to null', () => {
  for (const setup of ['base', 'ext56']) {
    const gen = generateBoard({ setup, seed: 7 });
    const enc = encodeBoard(gen);
    assert.match(enc.b, /^[wbhsod](?:\d{1,2})?(?:[wbhsod](?:\d{1,2})?)*$/); assert.ok(enc.b.length <= 3 * gen.hexes.length);
    const back = decodeBoard(setup, enc.b, enc.h);
    assert.ok(back); assert.deepEqual(back.hexes.map(x => [x.resource, x.number]), gen.hexes.map(x => [x.resource, x.number]));
    assert.deepEqual(back.harbors, gen.harbors);
  }
  const b = blankBoard('base'); b.hexes[3] = { ...b.hexes[3], resource: 'ore', number: 8 };
  const enc = encodeBoard(b); assert.equal(decodeBoard('base', enc.b, enc.h).hexes[3].number, 8);
  assert.equal(decodeBoard('base', 'w8w8', ''), null, 'wrong hex count');
  assert.equal(decodeBoard('base', 'x8'.repeat(19), ''), null, 'unknown resource letter');
  assert.equal(decodeBoard('base', 'w7'.repeat(19), ''), null, 'no 7 token');
  assert.equal(decodeBoard('base', 'w13'.repeat(19), ''), null, 'no 13 token');
  assert.equal(decodeBoard('base', 'w8'.repeat(19), '9999:w'), null, 'harbour on a non-coastal edge id');
  assert.equal(decodeBoard('base', 'w8'.repeat(19), '0:zz'), null, 'unknown harbour type');
  assert.equal(decodeBoard('nope', 'w8'.repeat(19), ''), null, 'unknown setup');
});

test('checkTiles: compares what was entered with the official box, and stays quiet when it matches', () => {
  const gen = generateBoard({ setup: 'base', seed: 42 });
  assert.deepEqual(checkTiles(gen), []);
  const hx = gen.hexes.map(h => ({ resource: h.resource, number: h.number }));
  const i = hx.findIndex(h => h.resource !== 'ore' && h.number !== 8), j = hx.findIndex((h, k) => k !== i && h.resource !== 'ore' && h.number !== 8);
  hx[i] = { resource: 'ore', number: 8 }; hx[j] = { resource: 'blank', number: null };
  const notes = checkTiles(boardFrom({ setup: 'base', hexes: hx, harbors: {} }));
  assert.ok(notes.length >= 2, notes.join(' | '));
  assert.ok(notes.some(n => /blank/i.test(n)), 'mentions unpainted hexes');
  assert.ok(notes.some(n => /ore/i.test(n)), 'mentions the extra ore');
  assert.ok(notes.some(n => /\b8\b/.test(n)), 'mentions the token count');
  assert.ok(checkTiles(boardFrom({ setup: 'base', hexes: gen.hexes, harbors: {} })).some(n => /harbou?r/i.test(n)), 'mentions missing harbours');
});

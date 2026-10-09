import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, boardFrom, blankBoard, RESOURCES } from '../public/board.js';
import { openingFacts } from '../public/score.js';

test('an opening with twenty pips exposes its starting hand and wheat/ore build dependencies', () => {
  const board = generateBoard({ seed: 4 });
  const before = JSON.stringify(board);
  const facts = openingFacts(board, [42, 4]);
  assert.deepEqual(facts.pips, { wood: 4, brick: 5, wheat: 0, sheep: 11, ore: 0 });
  assert.equal(facts.totalPips, 20);
  assert.equal(facts.incomeWays, 20);
  assert.deepEqual(facts.missingResources, ['wheat', 'ore']);
  assert.deepEqual(facts.startingCards, { wood: 0, brick: 1, wheat: 0, sheep: 1, ore: 0 });
  assert.deepEqual(facts.tradeRates, { wood: 4, brick: 4, wheat: 4, sheep: 4, ore: 4 });
  const builds = Object.fromEntries(facts.builds.map(b => [b.key, b]));
  assert.deepEqual(builds.road.cost, { wood: 1, brick: 1 });
  assert.deepEqual(builds.settlement.cost, { wood: 1, brick: 1, wheat: 1, sheep: 1 });
  assert.deepEqual(builds.city.cost, { wheat: 2, ore: 3 });
  assert.deepEqual(builds.development.cost, { wheat: 1, sheep: 1, ore: 1 });
  assert.deepEqual(builds.road.needs, { wood: 1 });
  assert.deepEqual(builds.road.missingProduction, []);
  assert.deepEqual(builds.settlement.needs, { wood: 1, wheat: 1 });
  assert.deepEqual(builds.settlement.missingProduction, ['wheat']);
  assert.deepEqual(builds.city.needs, { wheat: 2, ore: 3 });
  assert.deepEqual(builds.city.missingProduction, ['wheat', 'ore']);
  assert.deepEqual(builds.development.needs, { wheat: 1, ore: 1 });
  assert.equal(builds.road.handCoversCost, false);
  assert.equal(JSON.stringify(board), before);
  builds.city.cost.ore = 99;
  assert.equal(openingFacts(board, [42, 4]).builds.find(b => b.key === 'city').cost.ore, 3);
});

test('twenty-two expected cards can arrive on only fourteen of the thirty-six dice outcomes', () => {
  const facts = openingFacts(generateBoard({ seed: 18 }), [9, 44]);
  assert.deepEqual(facts.pips, { wood: 0, brick: 2, wheat: 9, sheep: 8, ore: 3 });
  assert.equal(facts.totalPips, 22);
  assert.equal(facts.incomeWays, 14);
  assert.deepEqual(facts.startingCards, { wood: 0, brick: 1, wheat: 1, sheep: 1, ore: 0 });
  assert.deepEqual(facts.rolls.find(r => r.number === 8).cards, { wood: 0, brick: 0, wheat: 1, sheep: 1, ore: 0 });
  assert.equal(facts.rolls.find(r => r.number === 8).totalCards, 2);
  assert.equal(facts.rolls.find(r => r.number === 7).totalCards, 0);
  assert.equal(facts.rolls.reduce((sum, r) => sum + r.ways, 0), 36);
  const reversed = openingFacts(generateBoard({ seed: 18 }), [44, 9]);
  assert.deepEqual(reversed.pips, facts.pips);
  assert.equal(reversed.builds.find(b => b.key === 'development').handCoversCost, true);
  assert.deepEqual(reversed.builds.find(b => b.key === 'development').needs, {});
});

test('two settlements on one hex double the cards without doubling the chance of income', () => {
  const board = boardFrom({ setup: 'base', hexes: [{ resource: 'wood', number: 6 }, ...Array.from({ length: 18 }, () => ({ resource: 'desert' }))] });
  const [a, , , b] = board.graph.hexes[0].corners;
  const facts = openingFacts(board, [a, b]);
  assert.equal(facts.pips.wood, 10);
  assert.equal(facts.incomeWays, 5);
  assert.equal(facts.rolls.find(r => r.number === 6).cards.wood, 2);
  assert.equal(facts.startingCards.wood, 1);
});

test('only owned harbours improve bank rates, and excluding them leaves the physical board intact', () => {
  const board = generateBoard({ seed: 42 });
  const [first, far] = [board.graph.perimeter[0], board.graph.perimeter[15]];
  board.harbors = { [first]: '3:1', [far]: 'wood' };
  const ids = [board.graph.edges[first].v[0], board.graph.edges[far].v[0]];
  const facts = openingFacts(board, ids);
  assert.deepEqual(facts.tradeRates, { wood: 2, brick: 3, wheat: 3, sheep: 3, ore: 3 });
  const ignored = openingFacts({ ...board, harbors: {} }, ids);
  assert.deepEqual(ignored.tradeRates, { wood: 4, brick: 4, wheat: 4, sheep: 4, ore: 4 });
  assert.equal(Object.keys(board.harbors).length, 2);
});

test('opening facts reject incomplete input, illegal pairs and invalid harbour geometry', () => {
  const board = generateBoard({ seed: 42 });
  for (const ids of [null, [], [0], [0, 0], [0, 1], [-1, 4], [0, 9999], [0, 4, 20]]) assert.equal(openingFacts(board, ids), null);
  assert.equal(openingFacts(blankBoard('base'), [42, 4]), null);
  assert.equal(openingFacts({ ...board, harbors: { 9999: 'wood' } }, [42, 4]), null);
});

test('opening income matches independent enumeration of all thirty-six dice outcomes on both layouts', () => {
  for (const setup of ['base', 'ext56']) for (let seed = 0; seed < 20; seed++) {
    const board = generateBoard({ setup, seed });
    const first = board.graph.vertices[seed % board.graph.vertices.length];
    const second = board.graph.vertices.find(v => v.id !== first.id && !v.neighbors.includes(first.id));
    const ids = [first.id, second.id];
    const expected = Object.fromEntries(RESOURCES.map(r => [r, 0]));
    let incomeWays = 0;
    for (let d1 = 1; d1 <= 6; d1++) for (let d2 = 1; d2 <= 6; d2++) {
      let cards = 0;
      for (const id of ids) for (const hid of board.graph.vertices[id].hexes) {
        const h = board.hexes[hid];
        if (h.number === d1 + d2) { expected[h.resource]++; cards++; }
      }
      if (cards) incomeWays++;
    }
    const facts = openingFacts(board, ids);
    assert.deepEqual(facts.pips, expected, `${setup}/${seed}`);
    assert.equal(facts.incomeWays, incomeWays);
    assert.equal(facts.totalPips, Object.values(expected).reduce((a, b) => a + b, 0));
  }
});

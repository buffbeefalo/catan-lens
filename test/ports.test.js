import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, RESOURCES, harborStatus } from '../public/board.js';
import { scoreVertex, rankSpots, openingFacts } from '../public/score.js';
import { legalVertices } from '../public/geometry.js';

const settings = { players: 4, seat: 1, cak: false };
const context = { mine: [0], occupied: [0] };
const plans = [settings, { ...settings, seat: 4 }, { ...settings, cak: true }];
const types = ['3:1', ...RESOURCES];
const port = score => score.parts.find(part => part.k === 'port');
function boardWith(harbors) {
  const board = { ...generateBoard({ seed: 42 }), harbors };
  assert.equal(harborStatus(board).valid, true);
  assert.ok(legalVertices(board.graph, [0]).includes(16));
  assert.ok(legalVertices(board.graph, [0]).includes(4));
  return board;
}

test('owned harbour types earn no duplicate credit at the second settlement', () => {
  for (const type of types) for (const plan of plans) {
    const firstOnly = boardWith({ 5: type });
    const duplicate = boardWith({ 5: type, 19: type });
    const before = scoreVertex(firstOnly, plan, 16, context);
    const after = scoreVertex(duplicate, plan, 16, context);
    assert.deepEqual(openingFacts(firstOnly, [0, 16]).tradeRates, openingFacts(duplicate, [0, 16]).tradeRates);
    assert.equal(port(after), undefined, `${type}: already available from corner 0`);
    assert.match(after.parts.find(part => part.k === 'port-owned').text, /does not improve your trade rate/);
    assert.equal(after.score, before.score);
    assert.deepEqual(duplicate.harbors, { 5: type, 19: type }, 'scoring must preserve the entered coast');
  }
});

test('a reachable duplicate harbour earns no expansion-port credit', () => {
  for (const type of types) for (const plan of plans) {
    const firstOnly = boardWith({ 5: type });
    const duplicate = boardWith({ 5: type, 19: type });
    const noOwnership = scoreVertex(duplicate, plan, 4);
    assert.match(port(noOwnership).text, /Two roads and a new settlement/);
    const after = scoreVertex(duplicate, plan, 4, context);
    assert.equal(port(after), undefined, `${type}: another copy cannot improve owned trading access`);
    assert.equal(after.score, scoreVertex(firstOnly, plan, 4, context).score);
  }
});

test('generic and resource-specific ports still earn credit when they improve different trade rates', () => {
  for (const resource of RESOURCES) {
    const specific = boardWith({ 5: '3:1', 19: resource });
    assert.ok(port(scoreVertex(specific, settings, 16, context)).v > 0);
    const rates = openingFacts(specific, [0, 16]).tradeRates;
    assert.equal(rates[resource], 2);
    assert.ok(RESOURCES.filter(r => r !== resource).every(r => rates[r] === 3));
    const generic = boardWith({ 5: resource, 19: '3:1' });
    assert.equal(port(scoreVertex(generic, settings, 16, context)).v, 1);
    assert.deepEqual(openingFacts(generic, [0, 16]).tradeRates, rates);
  }
});

test('a redundant port on the candidate corner does not hide a useful reachable port', () => {
  const board = boardWith({ 5: '3:1', 19: '3:1', 34: 'wood' });
  const result = scoreVertex(board, settings, 16, context);
  assert.match(port(result).text, /Two roads and a new settlement would reach the 2:1 wood port/);
  assert.equal(result.score, scoreVertex(boardWith({ 5: '3:1', 34: 'wood' }), settings, 16, context).score);
});

test('reproduced second-pick recommendations no longer depend on duplicate harbour credit', () => {
  for (const example of [
    { seed: 87, players: 4, seat: 4, first: 46, occupied: [20, 9, 14, 46], best: 30 },
    { seed: 116, players: 5, seat: 5, first: 16, occupied: [42, 53, 25, 60, 16], best: 38 },
  ]) {
    const board = generateBoard({ seed: example.seed, setup: example.players > 4 ? 'ext56' : 'base' });
    const ranking = rankSpots(board, { ...settings, players: example.players, seat: example.seat }, { mine: [example.first], occupied: example.occupied });
    assert.equal(ranking[0].id, example.best, `seed ${example.seed}`);
  }
});

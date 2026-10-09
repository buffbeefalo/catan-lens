import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, harborStatus, checkTiles } from '../public/board.js';

test('harbour status accepts the generated inventories on both board shapes', () => {
  for (const setup of ['base', 'ext56']) for (let seed = 0; seed < 40; seed++) {
    const status = harborStatus(generateBoard({ setup, seed }));
    assert.equal(status.valid, true, `${setup} seed ${seed}`);
    assert.equal(status.standard, true);
    assert.equal(status.count, setup === 'base' ? 9 : 11);
    assert.equal(status.expected, status.count);
    assert.deepEqual(status.conflictEdges, []);
    assert.deepEqual(status.invalidEdges, []);
  }
});

test('harbour status distinguishes a valid custom inventory from a complete standard inventory', () => {
  const board = generateBoard({ seed: 42 });
  const missing = { ...board, harbors: {} };
  assert.equal(harborStatus(missing).valid, true);
  assert.equal(harborStatus(missing).standard, false);
  assert.equal(harborStatus(missing).count, 0);
  assert.deepEqual(checkTiles(missing, { harbors: false }), [], 'missing ports do not imply wrong land inventory');
  const changedType = { ...board, harbors: { ...board.harbors, [Object.keys(board.harbors)[0]]: 'ore' } };
  assert.equal(harborStatus(changedType).valid, true);
  assert.equal(harborStatus(changedType).standard, false, 'correct count alone does not establish the port types');
});

test('harbour status identifies overlapping corners, inland edges and unknown types, and accepts a repaired layout', () => {
  const board = generateBoard({ seed: 42 });
  const first = Number(Object.keys(board.harbors)[0]);
  const shared = board.graph.perimeter.find(id => !board.harbors[id] && board.graph.edges[id].v.some(v => board.graph.edges[first].v.includes(v)));
  const conflict = { ...board, harbors: { ...board.harbors, [shared]: 'ore' } };
  assert.equal(harborStatus(conflict).valid, false);
  assert.ok(harborStatus(conflict).conflictEdges.includes(first));
  assert.ok(harborStatus(conflict).conflictEdges.includes(shared));
  delete conflict.harbors[shared];
  assert.equal(harborStatus(conflict).standard, true);
  const inland = board.graph.edges.find(e => e.hexes.length === 2).id;
  for (const [edge, type] of [[inland, 'wood'], [first, 'unknown'], [9999, '3:1']]) {
    const status = harborStatus({ ...board, harbors: { [edge]: type } });
    assert.equal(status.valid, false);
    assert.equal(status.standard, false);
    assert.ok(status.invalidEdges.includes(String(edge)));
  }
});

// Held-out positions for the human studies (study/README.md). The file must match its generator byte for byte, follow
// the predeclared selection rule, be legal under the distance rule, and say nothing about any policy's choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBoard, boardFrom } from '../public/board.js';
import { legalVertices } from '../public/geometry.js';
import { buildPositions, formatPositions } from '../study/positions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = join(ROOT, 'study', 'positions-2026-10-12.json');
const text = readFileSync(FILE, 'utf8');
const data = JSON.parse(text);
const SNAKE = [1, 2, 3, 4, 4, 3, 2, 1];   // 4-player placement order

test('the positions file is exactly what the generator writes, and the generator is deterministic', () => {
  const a = buildPositions(), b = buildPositions();
  assert.deepEqual(a, b, 'two runs give the same positions');
  assert.equal(formatPositions(a), text, 'study/positions-2026-10-12.json matches node study/positions.mjs');
});

test('positions follow the predeclared rule: 24 consecutive seeds from 9,000,000, seats 1 to 4 in turn, tasks alternating every four', () => {
  assert.equal(data.version, 'positions-2026-10-12');
  assert.equal(data.positions.length, 24);
  data.positions.forEach((p, k) => {
    assert.equal(p.id, `P${String(k + 1).padStart(2, '0')}`);
    assert.equal(p.seed, 9000000 + k);
    assert.equal(p.setup, 'base');
    assert.equal(p.players, 4);
    assert.equal(p.seat, [1, 2, 3, 4][k % 4]);
    assert.equal(p.task, Math.floor(k / 4) % 2 === 0 ? 'first' : 'second', `${p.id} task`);
  });
  const tasks = data.positions.map(p => p.task);
  assert.equal(tasks.filter(t => t === 'first').length, 12);
  assert.deepEqual(data.learningForms, {
    A: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08'],
    B: ['P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16'],
    C: ['P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23', 'P24'],
  });
  for (const ids of Object.values(data.learningForms)) {
    const combos = ids.map(id => data.positions.find(p => p.id === id)).map(p => `${p.seat}-${p.task}`).sort();
    assert.deepEqual(combos, ['1-first', '1-second', '2-first', '2-second', '3-first', '3-second', '4-first', '4-second']);
  }
});

test('every position is the stored board for its seed, legal under the distance rule, at the task player\'s turn', () => {
  for (const p of data.positions) {
    const generated = generateBoard({ setup: 'base', seed: p.seed, balanced: true });
    assert.deepEqual(p.hexes, generated.hexes.map(h => ({ resource: h.resource, number: h.number })), `${p.id} tiles`);
    assert.deepEqual(p.harbors, JSON.parse(JSON.stringify(generated.harbors)), `${p.id} harbours`);
    const board = boardFrom({ setup: p.setup, hexes: p.hexes, harbors: p.harbors });
    assert.deepEqual(p.placed.map(x => x.order), p.placed.map((x, i) => i + 1), `${p.id} placement order`);
    assert.deepEqual(p.placed.map(x => x.seat), SNAKE.slice(0, p.placed.length), `${p.id} owners follow the snake order`);
    const ids = p.placed.map(x => x.corner - 1);
    ids.forEach((id, i) => assert.ok(legalVertices(board.graph, ids.slice(0, i)).includes(id), `${p.id}: piece ${i + 1} was legal when placed`));
    assert.equal(SNAKE[p.placed.length], p.seat, `${p.id}: the next settlement is the task player's`);
    assert.equal(p.placed.length < 4 ? 'first' : 'second', p.task, `${p.id}: task matches the round`);
    assert.equal(p.placed.filter(x => x.seat === p.seat).length, p.task === 'first' ? 0 : 1, `${p.id}: own pieces already down`);
    assert.ok(legalVertices(board.graph, ids).length > 0, `${p.id}: an open corner exists`);
  }
  assert.equal(new Set(data.positions.map(p => p.seed)).size, 24, 'one position per board');
});

test('the positions file carries the position and nothing about any policy\'s choice', () => {
  for (const p of data.positions) {
    assert.deepEqual(Object.keys(p).sort(), ['harbors', 'hexes', 'id', 'placed', 'players', 'seat', 'seed', 'setup', 'task']);
    for (const x of p.placed) assert.deepEqual(Object.keys(x).sort(), ['corner', 'order', 'seat']);
    for (const h of p.hexes) assert.deepEqual(Object.keys(h).sort(), ['number', 'resource']);
  }
  assert.doesNotMatch(text, /"(score|rank|ranking|best|choice|recommend\w*|policy|classic|lookahead|explain\w*)"\s*:/i);
});

test('the reserved seed block 9,000,000 to 9,000,999 appears in no benchmark, test, script or app file', () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const f = join(dir, name); if (statSync(f).isDirectory()) walk(f); else files.push(f); } };
  for (const dir of ['bench', 'test', 'e2e', 'scripts', 'public']) walk(join(ROOT, dir));
  const own = fileURLToPath(import.meta.url);
  const hits = [];
  for (const f of files) {
    if (f === own || !/\.(m?js|cjs|py|sh|md|json|html)$/.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/(?<![\w.])\d[\d,_]*(?!\w)/g)) {   // whole numbers only, not digits inside hashes
      const n = Number(m[0].replace(/[,_]/g, ''));
      if (n >= 9000000 && n <= 9000999) hits.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

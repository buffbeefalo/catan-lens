// The blinded review page (study/review.html): it may load the board and geometry code and the positions file, never
// a ranking, score or explanation, and it sends nothing anywhere. Answers are cleaned with the distance rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../public/geometry.js';
import { cleanAnswer, openCorners, pickForm } from '../study/review.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(join(ROOT, 'study', 'positions-2026-10-12.json'), 'utf8'));
const position = id => data.positions.find(p => p.id === id);

// Every file the page loads: its script tags, then every static or dynamic import, followed recursively.
function pageFiles(html) {
  const page = readFileSync(join(ROOT, html), 'utf8');
  const scripts = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const todo = scripts.map(([, attrs, body]) => {
    assert.equal(body.trim(), '', 'no inline script code');
    assert.match(attrs, /type="module"/);
    return resolve(dirname(join(ROOT, html)), /src="([^"]+)"/.exec(attrs)[1]);
  });
  const seen = new Set();
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.m?js$/.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /\bimport\s*\(\s*[^'"\s]/, `${file}: no computed dynamic import`);
    for (const m of src.matchAll(/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)) todo.push(resolve(dirname(file), m[1] || m[2]));
  }
  return [...seen].map(f => relative(ROOT, f)).sort();
}

test('the review page loads only the board and geometry code and the positions file: no ranking, score or explanation code', () => {
  const files = pageFiles('study/review.html');
  assert.deepEqual(files, ['public/board.js', 'public/geometry.js', 'study/positions-2026-10-12.json', 'study/review.js']);
  for (const policy of ['public/score.js', 'public/lookahead.js', 'public/drill.js', 'public/app.js']) assert.ok(!files.includes(policy), policy);
});

test('the review page sends nothing anywhere: no network calls and no outside addresses', () => {
  for (const file of pageFiles('study/review.html').filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|https?:\/\//, file);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'study/review.html'), 'utf8'), /(src|href|action)\s*=\s*"(https?:)?\/\//);
});

test('open corners follow the distance rule around the placed pieces and any extra corner', () => {
  const g = buildGraph('base');
  const empty = position('P01');
  assert.equal(openCorners(empty).length, 54, 'every corner is open on an empty board');
  const [a, b] = g.vertices[0].neighbors;
  assert.deepEqual(openCorners(empty, [1]).filter(n => [1, a + 1, b + 1].includes(n)), [], 'a corner and its neighbours close once it is taken');
  const late = position('P05');
  const placed = late.placed.map(x => x.corner);
  for (const n of placed) assert.ok(!openCorners(late).includes(n), `placed corner ${n} is not open`);
  for (const n of placed) for (const nb of g.vertices[n - 1].neighbors) assert.ok(!openCorners(late).includes(nb + 1), `neighbour ${nb + 1} of ${n} is not open`);
});

test('cleaning an answer keeps only legal choices: open corner, a compatible planned second, alternatives other than the choice', () => {
  const g = buildGraph('base');
  const first = position('P01');   // seat 1, first settlement, empty board
  const neighbour = g.vertices[0].neighbors[0] + 1;
  assert.deepEqual(cleanAnswer(first, { choice: 1, plannedSecond: neighbour, acceptable: [1, 2, 2, 99, '3'], confidence: 7, reasoning: '  near the 8  ' }),
    { choice: 1, plannedSecond: null, acceptable: [2], confidence: null, reasoning: 'near the 8' });
  assert.deepEqual(cleanAnswer(first, { choice: 1, plannedSecond: 41, acceptable: [], confidence: 5, reasoning: '' }),
    { choice: 1, plannedSecond: 41, acceptable: [], confidence: 5, reasoning: '' });
  assert.equal(cleanAnswer(first, { choice: null, plannedSecond: 41 }).plannedSecond, null, 'no planned second without a first');
  const second = position('P05');   // seat 1, second settlement
  const taken = second.placed[0].corner;
  assert.equal(cleanAnswer(second, { choice: taken }).choice, null, 'an occupied corner is not a choice');
  const open = openCorners(second)[0];
  assert.deepEqual(cleanAnswer(second, { choice: open, plannedSecond: openCorners(second, [open])[0], confidence: 3 }),
    { choice: open, plannedSecond: null, acceptable: [], confidence: 3, reasoning: '' }, 'a second-settlement task has no planned second');
  assert.equal(cleanAnswer(first, { reasoning: 'x'.repeat(900) }).reasoning.length, 800, 'reasoning stays short');
});

test('a learning test form shows only its 8 positions; anything else shows every position for the expert review', () => {
  for (const [f, ids] of Object.entries(data.learningForms)) {
    const { form, list } = pickForm(f, data);
    assert.equal(form, f);
    assert.deepEqual(list.map(p => p.id), ids);
  }
  for (const other of [null, '', 'Z', 'a', 'toString', '__proto__']) {
    const { form, list } = pickForm(other, data);
    assert.equal(form, null, String(other));
    assert.equal(list.length, 24, String(other));
  }
});

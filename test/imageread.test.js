// Reading a board from a picture (public/imageread.js), checked against synthetic boards with known truth drawn by
// scripts/make-board-fixtures.cjs: the app's own look, another online renderer's look, a photo-like version (tilted,
// unevenly lit, blurred, noisy, JPEG-compressed) and a palette no board uses. Each picture is read with exact taps
// and with jittered taps, and the accuracy table is printed with the test output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from './png.js';
import { referenceTiles, homography, project, assign, readBoard } from '../public/imageread.js';
import { SETUPS, rng, boardFrom, checkTiles } from '../public/board.js';
import { buildGraph } from '../public/geometry.js';

const dir = new URL('./fixtures/imageread/', import.meta.url);
const shots = JSON.parse(readFileSync(new URL('truth.json', dir), 'utf8')).images;
const pictures = new Map();
const picture = file => { if (!pictures.has(file)) pictures.set(file, decodePng(readFileSync(new URL(file, dir)))); return pictures.get(file); };
const exactTaps = shot => referenceTiles(shot.setup).map(r => ({ x: shot.hexes[r.id].x, y: shot.hexes[r.id].y }));
const counts = xs => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});

// Each tap lands up to 6% of the token spacing away from the token centre on each axis (up to 8.5% in total), the
// spacing measured to the tapped tile's neighbour in the same row of the picture.
const JITTER = 0.06, TRIALS = 3;
function jitteredTaps(shot, rand) {
  return referenceTiles(shot.setup).map((r, k) => {
    const p = shot.hexes[r.id], q = shot.hexes[r.id + (k === 0 || k === 3 ? 1 : -1)], s = Math.hypot(p.x - q.x, p.y - q.y);
    return { x: p.x + (rand() * 2 - 1) * JITTER * s, y: p.y + (rand() * 2 - 1) * JITTER * s };
  });
}

let readings = null;   // every picture read with exact taps and TRIALS jittered tap sets, shared by several tests
function allReadings() {
  if (readings) return readings;
  readings = [];
  for (const shot of shots) {
    const rand = rng(shot.seed * 7919 + 1);
    for (let trial = 0; trial <= TRIALS; trial++) {
      const taps = trial ? jitteredTaps(shot, rand) : exactTaps(shot);
      readings.push({ shot, trial, out: readBoard(picture(shot.file), shot.setup, taps) });
    }
  }
  return readings;
}

test('the reference tiles are the corner tiles of the top and bottom rows, in tap order', () => {
  assert.deepEqual(referenceTiles('base').map(r => r.id), [0, 2, 18, 16]);
  assert.deepEqual(referenceTiles('ext56').map(r => r.id), [0, 2, 29, 27]);
  for (const setup of ['base', 'ext56']) {
    const { hexes } = buildGraph(SETUPS[setup].layout);
    for (const r of referenceTiles(setup)) assert.deepEqual([r.x, r.y], [hexes[r.id].x, hexes[r.id].y]);
    assert.deepEqual(referenceTiles(setup).map(r => r.corner), ['top left', 'top right', 'bottom right', 'bottom left']);
  }
  assert.throws(() => referenceTiles('huge'), /Unknown board layout "huge"/);
});

test('homography maps the four points exactly and agrees with the true perspective everywhere else', () => {
  const H0 = [0.82, -0.31, 140, 0.12, 0.95, 60, 0.0009, -0.0004, 1];   // a tilted, turned, shifted view
  const from = [{ x: 0, y: 0 }, { x: 400, y: 30 }, { x: 380, y: 300 }, { x: 20, y: 260 }], to = from.map(p => project(H0, p));
  const H = homography(from, to);
  from.forEach((p, i) => { const q = project(H, p); assert.ok(Math.hypot(q.x - to[i].x, q.y - to[i].y) < 1e-8, `corner ${i}`); });
  for (let x = -100; x <= 500; x += 50) for (let y = -100; y <= 400; y += 50) {
    const q = project(H, { x, y }), r = project(H0, { x, y });
    assert.ok(Math.hypot(q.x - r.x, q.y - r.y) < 1e-6, `point ${x},${y}`);
  }
  // More than four exact pairs give the same map, and the reverse map undoes it.
  const many = [...from, { x: 200, y: 150 }, { x: 50, y: 120 }, { x: 330, y: 80 }];
  const Hm = homography(many, many.map(p => project(H0, p)));
  for (let k = 0; k < 9; k++) assert.ok(Math.abs(Hm[k] - H[k]) < 1e-8 * Math.max(1, Math.abs(H[k])), `entry ${k}`);
  const back = homography(to, from);
  for (const p of [{ x: 123, y: 45 }, { x: -60, y: 310 }]) { const q = project(back, project(H, p)); assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1e-6); }
});

test('homography refuses points that cannot fix a perspective map', () => {
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.throws(() => homography(sq, [sq[0], sq[0], sq[2], sq[3]]), /too close together or in a line/);
  assert.throws(() => homography(sq, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 5 }]), /too close together or in a line/);
  assert.throws(() => homography(sq.slice(0, 3), sq.slice(0, 3)), /at least four matching pairs/);
  assert.throws(() => homography(sq, [...sq.slice(0, 3), { x: NaN, y: 0 }]), /finite x and y/);
});

test('the assignment step finds the cheapest one-to-one assignment', () => {
  const rand = rng(11);
  const permutations = n => (n === 1 ? [[0]] : permutations(n - 1).flatMap(p => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])));
  for (let round = 0; round < 25; round++) {
    const n = 2 + (round % 5), cost = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.round(rand() * 50)));
    const got = assign(cost), best = Math.min(...permutations(n).map(p => p.reduce((s, c, r) => s + cost[r][c], 0)));
    assert.deepEqual([...got].sort((a, b) => a - b), [...Array(n).keys()], 'each column used once');
    assert.equal(got.reduce((s, c, r) => s + cost[r][c], 0), best);
  }
});

test('every reading respects the box: tile counts always match, deserts never carry a number', () => {
  for (const { shot, trial, out } of allReadings()) {
    assert.equal(out.hexes.length, shot.hexes.length);
    assert.deepEqual(counts(out.hexes.map(h => h.resource)), SETUPS[shot.setup].tiles, `${shot.file} trial ${trial}`);
    for (const h of out.hexes) if (h.resource === 'desert') assert.equal(h.number, null);
    for (const h of out.hexes) assert.ok(h.resourceConfidence >= 0 && h.resourceConfidence <= 1 && h.numberConfidence >= 0 && h.numberConfidence <= 1);
  }
});

// Thresholds from measurements (2026-10-12). With these taps every style read every tile right; flagged: app 0%,
// flat 0.6%, photo-like 12.1% (mostly 5 or 9 and 6 or 8, told apart only by holes that blur). Other jitter draws,
// and jitter up to 15% of the token spacing, gave 99.6% to 100% of photo-like numbers, and every wrong read was
// flagged. The limits leave a little room for another font renderer, never room for a confident mistake.
const LIMITS = { app: { resources: 1, numbers: 0.99, flagged: 0.05 }, flat: { resources: 1, numbers: 0.99, flagged: 0.05 }, photo: { resources: 0.97, numbers: 0.96, flagged: 0.25 } };

test('accuracy per style with tap jitter', t => {
  const rows = {};
  for (const { shot, out } of allReadings()) {
    if (!LIMITS[shot.style]) continue;
    const s = rows[shot.style] ||= { pictures: new Set(), tiles: 0, tokens: 0, resources: 0, numbers: 0, flagged: 0, silent: 0 };
    s.pictures.add(shot.file);
    shot.hexes.forEach((truth, i) => {
      const got = out.hexes[i], flagged = out.uncertain.includes(i);
      s.tiles++; s.resources += got.resource === truth.resource; s.flagged += flagged;
      if (truth.number) { s.tokens++; s.numbers += got.number === truth.number; }
      if ((got.resource !== truth.resource || got.number !== truth.number) && !flagged) s.silent++;
    });
  }
  const pct = x => `${(100 * x).toFixed(1)}%`.padStart(7);
  t.diagnostic(`Exact taps plus ${TRIALS} jittered tap sets per picture (each tap moved up to ${JITTER * 100}% of the token spacing on each axis):`);
  t.diagnostic('style  pictures  tiles  resources  numbers  flagged  wrong but not flagged');
  for (const [style, s] of Object.entries(rows)) t.diagnostic(`${style.padEnd(6)} ${String(s.pictures.size).padStart(8)} ${String(s.tiles).padStart(6)} ${pct(s.resources / s.tiles).padStart(10)} ${pct(s.numbers / s.tokens).padStart(8)} ${pct(s.flagged / s.tiles).padStart(8)} ${String(s.silent).padStart(22)}`);
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(LIMITS).sort(), 'every style has fixtures');
  for (const [style, s] of Object.entries(rows)) {
    const lim = LIMITS[style];
    assert.ok(s.resources / s.tiles >= lim.resources, `${style}: resources ${pct(s.resources / s.tiles)}`);
    assert.ok(s.numbers / s.tokens >= lim.numbers, `${style}: numbers ${pct(s.numbers / s.tokens)}`);
    assert.ok(s.flagged / s.tiles <= lim.flagged, `${style}: flagged ${pct(s.flagged / s.tiles)}`);
    assert.equal(s.silent, 0, `${style}: every wrong read is flagged`);
  }
});

test('an unseen palette produces flags and a warning, not confident guesses', () => {
  const unseen = allReadings().filter(r => r.shot.style === 'unseen');
  assert.ok(unseen.length > 0);
  for (const { shot, out } of unseen) {
    assert.ok(out.notes.some(n => /do not match any board style I know/.test(n)), 'the colour warning is shown');
    assert.ok(out.uncertain.length >= 0.9 * shot.hexes.length, `${out.uncertain.length} of ${shot.hexes.length} tiles flagged`);
    shot.hexes.forEach((truth, i) => { if (out.hexes[i].resource !== truth.resource) assert.ok(out.uncertain.includes(i) && out.hexes[i].resourceConfidence < 0.5, `tile ${i + 1} is wrong and must be flagged`); });
    // Numbers do not depend on colour, so they are still read.
    const tokens = shot.hexes.filter(h => h.number), right = shot.hexes.filter((h, i) => h.number && out.hexes[i].number === h.number);
    assert.ok(right.length >= 0.95 * tokens.length);
  }
});

test('a reading plugs straight into the board editor', () => {
  const { shot, out } = allReadings().find(r => r.shot.file === 'app-base-1.png' && r.trial === 0);
  const board = boardFrom({ setup: shot.setup, hexes: out.hexes, harbors: {} });
  assert.deepEqual(board.hexes.map(h => [h.resource, h.number]), shot.hexes.map(h => [h.resource, h.number]));
  assert.deepEqual(checkTiles(board, { harbors: false }), []);
  assert.deepEqual(out.uncertain, []);
  assert.deepEqual(out.notes, []);
});

test('same picture and taps give the same reading, and the picture is not changed', () => {
  const shot = shots.find(s => s.style === 'photo'), img = picture(shot.file), before = Buffer.from(img.data).toString('base64');
  const taps = exactTaps(shot);
  assert.deepEqual(readBoard(img, shot.setup, taps), readBoard(img, shot.setup, taps));
  assert.equal(Buffer.from(img.data).toString('base64'), before);
});

test('bad input fails with a clear error', () => {
  const shot = shots.find(s => s.file === 'app-base-1.png'), img = picture(shot.file), taps = exactTaps(shot);
  const blank = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(200) });
  const cases = [
    [() => readBoard(img, shot.setup, [taps[0], taps[0], taps[0], taps[0]]), /too close together or in a line/],
    [() => readBoard(img, shot.setup, [taps[0], { x: (taps[0].x + taps[1].x) / 2, y: taps[0].y }, taps[1], taps[2]]), /too close together or in a line/],
    [() => readBoard(img, shot.setup, [taps[1], taps[0], taps[3], taps[2]]), /go around the board in order/],
    [() => readBoard(img, shot.setup, [taps[0], taps[1], taps[3], taps[2]]), /go around the board in order/],
    [() => readBoard(img, shot.setup, [{ x: -4, y: 10 }, taps[1], taps[2], taps[3]]), /inside the picture/],
    [() => readBoard(img, shot.setup, taps.slice(0, 3)), /four corner tiles/],
    [() => readBoard(blank(40, 40), 'base', [{ x: 5, y: 5 }, { x: 30, y: 5 }, { x: 30, y: 30 }, { x: 5, y: 30 }]), /too small \(40 by 40 pixels\)/],
    [() => readBoard(blank(200, 200), 'base', [{ x: 90, y: 90 }, { x: 100, y: 90 }, { x: 100, y: 105 }, { x: 90, y: 105 }]), /board is too small in this picture/],
    [() => readBoard({ width: 100, height: 100, data: new Uint8ClampedArray(12) }, 'base', taps), /could not be read/],
    [() => readBoard(img, 'huge', taps), /Unknown board layout/],
    [() => readBoard(blank(img.width, img.height), shot.setup, taps), /could not find the number tokens/],
  ];
  // The wrong board size: a 30-tile picture read as 19 tiles, and the other way round.
  const big = shots.find(s => s.setup === 'ext56' && s.style === 'app');
  cases.push([() => readBoard(picture(big.file), 'base', exactTaps(big)), /19-tile board.*board size is right \(19 or 30 tiles\)/]);
  cases.push([() => readBoard(img, 'ext56', taps), /30-tile board.*board size is right/]);
  for (const [run, message] of cases) assert.throws(run, message);
});

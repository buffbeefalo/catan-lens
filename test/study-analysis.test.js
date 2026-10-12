// Study A analysis (study/analyze.mjs) on hand-made fixtures, the answer-file contract shared with the review page,
// and the synthetic demonstration files, which must never be mistaken for, or mixed with, real reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fleissKappa, summarize, readAnswers, checkMix, policyChoices } from '../study/analyze.mjs';
import { answerFile, openCorners } from '../study/review.js';
import { makeSynthetic } from '../study/demo/make-synthetic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(join(ROOT, 'study', 'positions-2026-10-12.json'), 'utf8'));
const position = id => data.positions.find(p => p.id === id);
const close = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 1e-12, `${what}: ${actual} versus ${expected}`);

// ---- Hand-made fixture -----------------------------------------------------------------------------------------
// Four positions, three reviewers, three corner labels (10, 20, 30). Top choices:
//        R1  R2  R3   policies (classic, look-ahead)
//   X1   10  10  10   10, 10  (agree)    seat 1, first settlement
//   X2   10  10  20   10, 20  (differ)   seat 2, first settlement
//   X3   20  30  30   20, 20  (agree)    seat 3, second settlement
//   X4   10  20  30   30, 10  (differ)   seat 4, second settlement
// Fleiss' kappa by hand, n = 3 ratings per position. P_i = (sum of squared category counts - n) / (n (n - 1)):
//   X1 counts {10:3}             -> (9 - 3) / 6 = 1
//   X2 counts {10:2, 20:1}       -> (4 + 1 - 3) / 6 = 1/3
//   X3 counts {20:1, 30:2}       -> (1 + 4 - 3) / 6 = 1/3
//   X4 counts {10:1, 20:1, 30:1} -> (1 + 1 + 1 - 3) / 6 = 0
//   mean P = (1 + 1/3 + 1/3 + 0) / 4 = 5/12 (also the pairwise agreement: the share of agreeing reviewer pairs)
//   category totals over 12 ratings: 10 -> 6, 20 -> 3, 30 -> 3, so p = 1/2, 1/4, 1/4
//   chance agreement Pe = 1/4 + 1/16 + 1/16 = 3/8
//   kappa = (5/12 - 3/8) / (1 - 3/8) = (10/24 - 9/24) / (15/24) = 1/15
const fixturePositions = [{ id: 'X1', seat: 1, task: 'first' }, { id: 'X2', seat: 2, task: 'first' }, { id: 'X3', seat: 3, task: 'second' }, { id: 'X4', seat: 4, task: 'second' }];
const choices = {
  X1: { classic: 10, lookahead: 10, pips: 30, open: 50, classicOpening: [10, 20], lookaheadOpening: [10, 40] },
  X2: { classic: 10, lookahead: 20, pips: 30, open: 40, classicOpening: [10, 40], lookaheadOpening: [20, 40] },
  X3: { classic: 20, lookahead: 20, pips: 30, open: 25 },
  X4: { classic: 30, lookahead: 10, pips: 30, open: 20 },
};
const r = (position, choice, acceptable = [], confidence = 3, plannedSecond = null) => ({ position, choice, plannedSecond, acceptable, confidence, reasoning: '' });
const files = [
  { label: 'R1', synthetic: false, ratings: [r('X1', 10, [20], 5, 20), r('X2', 10, [20], 4, 40), r('X3', 20, [], 3), r('X4', 10, [], 2)] },
  { label: 'R2', synthetic: false, ratings: [r('X1', 10, [], 4, 40), r('X2', 10, [], 4), r('X3', 30, [20], 4), r('X4', 20, [], 4)] },
  { label: 'R3', synthetic: false, ratings: [r('X1', 10, [30], 1), r('X2', 20, [10], 2, 40), r('X3', 30, [], 3), r('X4', 30, [], 4)] },
];

test('Fleiss\' kappa matches the hand calculation (1/15) and is 1 for perfect agreement', () => {
  const k = fleissKappa([[10, 10, 10], [10, 10, 20], [20, 30, 30], [10, 20, 30]]);
  close(k.observed, 5 / 12, 'mean agreement');
  close(k.expected, 3 / 8, 'chance agreement');
  close(k.kappa, 1 / 15, 'kappa');
  assert.equal(k.items, 4);
  close(fleissKappa([[1, 1], [2, 2], [3, 3]]).kappa, 1, 'perfect agreement');
  assert.equal(fleissKappa([[1]]).items, 0, 'one rating cannot agree with anyone');
});

test('agreement with each policy, acceptable sets and the panel, counted by hand on the fixture', () => {
  const s = summarize({ positions: fixturePositions, files, choices });
  assert.equal(s.ratings, 12);
  assert.deepEqual(s.top, { classic: 7, lookahead: 6, pips: 3 });
  assert.deepEqual(s.accepted, { classic: 9, lookahead: 8, pips: 4 });
  close(s.chance, (3 / 50 + 3 / 40 + 3 / 25 + 3 / 20) / 12, 'chance of matching a random open corner');
  // Panel sets (accepted by at least half of the 3 reviewers, so 2 or more): X1 {10}, X2 {10, 20}, X3 {20, 30}, X4 none.
  assert.deepEqual(s.byPosition.map(p => p.panel), [[10], [10, 20], [20, 30], []]);
  assert.deepEqual(s.panel, { positions: 4, classic: 3, lookahead: 3, pips: 1 });
  // Planned openings: R1 on X1 (10, 20) and on X2 (10, 40) match classic; R2 on X1 (10, 40) and R3 on X2 (20, 40) match look-ahead.
  assert.deepEqual(s.openings, { rated: 4, classic: 2, lookahead: 2 });
});

test('agreement between reviewers: pairwise share, kappa, acceptable-set overlap and every pair', () => {
  const { between } = summarize({ positions: fixturePositions, files, choices });
  close(between.pairwise, 5 / 12, 'pairwise agreement');
  close(between.kappa, 1 / 15, 'kappa');
  // Jaccard overlap of accepted sets, mean over pairs then positions: X1 (1/2 + 1/3 + 1/2) / 3 = 4/9, X2 2/3, X3 1/3, X4 0.
  close(between.jaccard, (4 / 9 + 2 / 3 + 1 / 3 + 0) / 4, 'acceptable-set overlap');
  assert.deepEqual(between.pairs, [{ a: 'R1', b: 'R2', shared: 4, agree: 2 }, { a: 'R1', b: 'R3', shared: 4, agree: 1 }, { a: 'R2', b: 'R3', shared: 4, agree: 2 }]);
});

test('results split by whether the policies agree, by seat and by task', () => {
  const { groups, reviewers } = summarize({ positions: fixturePositions, files, choices });
  const g = Object.fromEntries(groups.map(x => [x.key, [x.positions, x.ratings, x.classicTop, x.lookaheadTop, x.classicAccepted, x.lookaheadAccepted]]));
  assert.deepEqual(g, {
    same: [2, 6, 4, 4, 5, 5], different: [2, 6, 3, 2, 4, 3],
    'seat-1': [1, 3, 3, 3, 3, 3], 'seat-2': [1, 3, 2, 1, 3, 2], 'seat-3': [1, 3, 1, 1, 2, 2], 'seat-4': [1, 3, 1, 1, 1, 1],
    first: [2, 6, 5, 4, 6, 5], second: [2, 6, 2, 2, 3, 3],
  });
  // Per reviewer, top choice equal to classic / look-ahead: R1 X1 X2 X3 / X1 X3 X4; R2 X1 X2 / X1; R3 X1 X4 / X1 X2.
  assert.deepEqual(reviewers.map(x => [x.label, x.ratings, x.classicTop, x.lookaheadTop, x.meanConfidence]),
    [['R1', 4, 3, 3, 3.5], ['R2', 4, 2, 1, 4], ['R3', 4, 2, 2, 2.5]]);
});

test('reading answer files: illegal or unknown entries are reported and left out, never silently counted', () => {
  const late = position('P05');
  const file = { kind: 'catan-lens-study-answers', positions: data.version, study: 'expert-review', synthetic: false, reviewer: 'R9', form: null, answers: [
    { position: 'P05', choice: late.placed[0].corner, acceptable: [], confidence: 3, reasoning: '' },
    { position: 'P99', choice: 1, acceptable: [], confidence: 3, reasoning: '' },
    { position: 'P01', choice: 1, plannedSecond: 2, acceptable: [99], confidence: 9, reasoning: '' },
    { position: 'P06', choice: openCorners(position('P06'))[0], acceptable: [], confidence: 2, reasoning: 'ok' },
    { position: 'P06', choice: openCorners(position('P06'))[1], acceptable: [], confidence: 2, reasoning: 'again' },
  ] };
  const read = readAnswers(file, data, 'file.json');
  assert.equal(read.label, 'R9');
  assert.deepEqual(read.ratings.map(x => x.position), ['P01', 'P06']);
  assert.deepEqual(read.ratings[0], { position: 'P01', choice: 1, plannedSecond: null, acceptable: [], confidence: null, reasoning: '' });
  assert.equal(read.problems.length, 6, read.problems.join('\n'));   // occupied choice, unknown position, illegal second, bad alternative, bad confidence, repeat
  assert.throws(() => readAnswers({ ...file, positions: 'positions-1999-01-01' }, data, 'old.json'), /different positions/);
  assert.throws(() => readAnswers({ ...file, kind: 'something-else' }, data, 'x.json'), /not a Catan Lens answer file/);
  assert.throws(() => readAnswers({ ...file, study: 'learning-test', form: 'A' }, data, 'test.json'), /learning test/, 'a study B test is never counted as an expert review');
});

test('a file downloaded from the review page reads back exactly in the analysis', () => {
  const p1 = position('P01'), p6 = position('P06');
  const answers = {
    P01: { choice: 1, plannedSecond: 41, acceptable: [2, 7], confidence: 4, reasoning: 'Wheat and ore.' },
    P06: { choice: openCorners(p6)[2], plannedSecond: null, acceptable: [], confidence: 2, reasoning: '' },
    P07: { choice: null, plannedSecond: null, acceptable: [3], confidence: 5, reasoning: 'not chosen yet' },
  };
  const file = JSON.parse(JSON.stringify(answerFile({ data, code: 'R-07', answers, form: null, now: new Date('2026-10-12T12:00:00Z') })));
  assert.equal(file.synthetic, false);
  assert.equal(file.reviewer, 'R-07');
  assert.equal(file.exportedAt, '2026-10-12T12:00:00.000Z');
  const read = readAnswers(file, data, 'download.json');
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.ratings, [{ position: 'P01', ...answers.P01 }, { position: 'P06', ...answers.P06 }], 'unchosen positions are not exported');
  assert.ok(p1.task === 'first' && p6.task === 'second');
});

test('policy choices are computed only by the analysis, are open corners, and include an opening for first-settlement tasks', () => {
  for (const id of ['P01', 'P08']) {
    const p = position(id), c = policyChoices(p), open = openCorners(p);
    for (const k of ['classic', 'lookahead', 'pips']) assert.ok(open.includes(c[k]), `${id} ${k}`);
    assert.equal(c.open, open.length);
    if (p.task === 'first') for (const k of ['classicOpening', 'lookaheadOpening']) assert.ok(openCorners(p, [c[k][0]]).includes(c[k][1]), `${id} ${k}`);
    else assert.equal(c.classicOpening, undefined);
  }
});

test('synthetic demonstration files are labelled synthetic in name and content, and are reproducible', () => {
  const dir = join(ROOT, 'study', 'demo');
  const names = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  assert.ok(names.length >= 2);
  const made = makeSynthetic(data);
  assert.deepEqual(made.map(m => m.name).sort(), names);
  for (const name of names) {
    assert.match(name, /^synthetic-/);
    const text = readFileSync(join(dir, name), 'utf8'), file = JSON.parse(text);
    assert.equal(file.synthetic, true, name);
    assert.match(file.note, /^SYNTHETIC/, name);
    assert.match(file.reviewer, /^SYNTHETIC/, name);
    assert.equal(made.find(m => m.name === name).text, text, `${name} matches node study/demo/make-synthetic.mjs`);
    assert.deepEqual(readAnswers(file, data, name).problems, [], `${name} reads cleanly`);
  }
});

test('the analysis refuses to mix synthetic and real files, and labels a synthetic run and the caveat on every report', () => {
  assert.throws(() => checkMix([{ label: 'a', synthetic: true }, { label: 'b', synthetic: false }]), /synthetic/i);
  assert.doesNotThrow(() => checkMix([{ label: 'a', synthetic: true }, { label: 'b', synthetic: true }]));
  const demo = readdirSync(join(ROOT, 'study', 'demo')).filter(f => f.endsWith('.json')).map(f => join(ROOT, 'study', 'demo', f));
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'study', 'analyze.mjs'), ...args], { encoding: 'utf8' });
  const ok = run(...demo);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^SYNTHETIC DEMONSTRATION DATA/);
  assert.match(ok.stdout, /SYNTHETIC DEMONSTRATION DATA[^\n]*\n?$/);
  assert.match(ok.stdout, /not proof/i);
  assert.doesNotMatch(ok.stdout, /[\u2013\u2014]/, 'no en or em dashes in the report');
  const tmp = mkdtempSync(join(tmpdir(), 'catan-study-'));
  try {
    const out = join(tmp, 'results.json');
    assert.equal(run('--json', out, ...demo).status, 0);
    const json = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(json.synthetic, true);
    assert.match(json.note, /^SYNTHETIC DEMONSTRATION DATA/);
    assert.match(json.caveat, /one source of evidence, not proof/, 'the JSON results carry the caveat too');
    const real = join(tmp, 'answers.json');
    writeFileSync(real, JSON.stringify({ ...JSON.parse(readFileSync(demo[0], 'utf8')), synthetic: false, note: undefined, reviewer: 'R1' }));
    const mixed = run(demo[0], real);
    assert.notEqual(mixed.status, 0);
    assert.match(mixed.stderr, /synthetic/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

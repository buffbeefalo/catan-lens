import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, TABLES, MAX_LEVEL, ladderKey, stageFor, findSeed, setupStage, judge, normalizeProgress, applyProgressActions } from '../public/drill.js';
import { grade } from '../public/score.js';
import { legalVertices } from '../public/geometry.js';

const CONFIGS = [];
for (const players of [3, 4, 5, 6]) for (const cak of [false, true]) CONFIGS.push({ players, cak });

test('saved progress accepts unique bounded levels on known tables only', () => {
  const input = { ladders: { '4-base': [1, 1, -2, 0, 999999, '2', 2.5, 3, 2], '6-cak': [MAX_LEVEL], unknown: [1], '3-base': null } };
  assert.deepEqual(normalizeProgress(input), { ladders: { '4-base': [1, 2, 3], '6-cak': [MAX_LEVEL] } });
  assert.equal(input.ladders['4-base'].length, 9, 'normalization does not mutate saved input');
  for (const value of [null, [], 'bad', { cleared: [1, 2] }, { ladders: null }]) assert.deepEqual(normalizeProgress(value), { ladders: {} });
});

test('pending progress changes merge with the latest saved tables and replay resets in order', () => {
  const saved = { ladders: { '4-base': [1, 2], '6-cak': [1, 2, 3] } };
  const changes = [{ table: '4-base', level: 3 }, { table: '4-base', level: 3 }, { table: '4-base', reset: true }, { table: '4-base', level: 1 }];
  assert.deepEqual(applyProgressActions(saved, changes), { ladders: { '4-base': [1], '6-cak': [1, 2, 3] } });
  assert.deepEqual(saved.ladders['4-base'], [1, 2], 'the persisted snapshot stays untouched');
  assert.deepEqual(applyProgressActions(saved, [{ table: '4-base', level: -1 }, { table: 'unknown', level: 1 }]), saved);
});

test('stage ladder ramps: pass rule never loosens, last stage demands the #1 corner, beyond the ladder stays hardest', () => {
  assert.equal(STAGES.length, 16);
  for (let i = 1; i < STAGES.length; i++) assert.ok(STAGES[i].pass.top <= STAGES[i - 1].pass.top, `stage ${i + 1} pass rule not looser`);
  assert.equal(STAGES[STAGES.length - 1].pass.top, 1);
  assert.equal(STAGES[0].pass.top, 3);
  for (const s of STAGES) { assert.ok(['first', 'second', 'middle', 'penultimate', 'last'].includes(s.position), s.title); assert.ok(['first', 'second'].includes(s.task)); assert.ok(typeof s.title === 'string' && s.title.length); assert.equal(s.players, undefined, 'stages no longer fix the table'); assert.equal(s.cak, undefined); }
});

test('stageFor: the chosen table (players + C&K) is applied to every level, seats resolve inside the table, beyond the ladder repeats the hardest', () => {
  for (const cfg of CONFIGS) {
    for (let n = 1; n <= STAGES.length; n++) {
      const st = stageFor(n, cfg);
      assert.equal(st.n, n); assert.equal(st.players, cfg.players); assert.equal(st.cak, cfg.cak);
      assert.ok(Number.isInteger(st.seat) && st.seat >= 1 && st.seat <= cfg.players, `${cfg.players}p level ${n} seat ${st.seat}`);
      assert.equal(st.title, STAGES[n - 1].title); assert.deepEqual(st.pass, STAGES[n - 1].pass);
    }
    const beyond = stageFor(STAGES.length + 5, cfg);
    assert.equal(beyond.n, STAGES.length + 5);
    assert.deepEqual({ ...beyond, n: 0 }, { ...stageFor(STAGES.length, cfg), n: 0 });
  }
  // positions: first=1, second=2, last=P, penultimate=P-1, middle = the seat in the middle of the order
  assert.equal(stageFor(1, { players: 6, cak: false }).seat, 1);
  assert.equal(stageFor(4, { players: 3, cak: false }).seat, 2);
  assert.equal(stageFor(8, { players: 3, cak: false }).seat, 3);
  assert.equal(stageFor(8, { players: 6, cak: false }).seat, 6);
  assert.equal(stageFor(13, { players: 6, cak: false }).seat, 5);
  assert.equal(stageFor(13, { players: 4, cak: false }).seat, 3);
  assert.equal(stageFor(7, { players: 4, cak: false }).seat, 3);
  assert.equal(stageFor(7, { players: 6, cak: false }).seat, 4);
  assert.equal(stageFor(7, { players: 3, cak: false }).seat, 2);
  // the ladder uses every part of the order at least once for each table size
  for (const players of [3, 4, 5, 6]) {
    const seats = new Set(Array.from({ length: STAGES.length }, (_, i) => stageFor(i + 1, { players, cak: false }).seat));
    assert.ok(seats.has(1) && seats.has(players), `${players}p: first and last seats both drilled`);
    if (players >= 4) assert.ok(seats.size >= 4, `${players}p: at least four distinct seats drilled, got ${[...seats]}`);
  }
  // defaults: no table given = 4 players, base game
  assert.equal(stageFor(3).players, 4); assert.equal(stageFor(3).cak, false);
});

test('TABLES + ladderKey: one progress track per table', () => {
  assert.equal(TABLES.length, 8);
  assert.equal(new Set(TABLES.map(ladderKey)).size, 8);
  assert.equal(ladderKey({ players: 4, cak: false }), '4-base');
  assert.equal(ladderKey({ players: 6, cak: true }), '6-cak');
});

test('setupStage: pre-placed pieces are legal, opponents come from the seats that place before you, second-settlement stages give you a first — every table', () => {
  for (const cfg of CONFIGS) for (let n = 1; n <= STAGES.length; n++) {
    const st = stageFor(n, cfg);
    const r = setupStage(st, 7);
    assert.ok(r.board && r.board.graph, `stage ${st.n} board`);
    assert.equal(r.board.setup, cfg.players >= 5 ? 'ext56' : 'base', `${cfg.players}p uses the ${cfg.players >= 5 ? '5-6' : '3-4'} player board`);
    assert.equal(r.settings.cak, cfg.cak);
    const all = [...r.me, ...r.opp];
    for (let k = 0; k < all.length; k++) assert.ok(legalVertices(r.board.graph, all.slice(0, k)).includes(all[k]) || k === 0, `stage ${st.n} piece ${k} legal`);
    if (st.task === 'first') { assert.equal(r.me.length, 0); assert.equal(r.opp.length, st.seat - 1, `stage ${st.n}: ${st.seat - 1} seats place before you`); }
    else { assert.equal(r.me.length, 1); assert.equal(r.opp.length, (st.players - 1) + (st.players - st.seat), `stage ${st.n}: everyone's first + later seats' second`); }
    assert.ok(r.ranking.length > 1, 'corners left to choose from');
    assert.equal(typeof r.margin, 'number');
  }
});

test('findSeed: returns a seed whose board meets the stage margin band (or says it fell back) — every table', () => {
  for (const cfg of CONFIGS) {
    let rolls = 0; const rngSeq = () => { rolls++; return (rolls * 2654435761) >>> 0; };
    let fallbacks = 0;
    for (let n = 1; n <= STAGES.length; n++) {
      const st = stageFor(n, cfg);
      const f = findSeed(st, rngSeq, 300);
      const r = setupStage(st, f.seed);
      if (!f.fallback) {
        if (st.board.minMargin !== undefined) assert.ok(r.margin >= st.board.minMargin, `stage ${st.n} margin ${r.margin} < ${st.board.minMargin}`);
        if (st.board.maxMargin !== undefined) assert.ok(r.margin <= st.board.maxMargin, `stage ${st.n} margin ${r.margin} > ${st.board.maxMargin}`);
      } else fallbacks++;
      assert.ok(f.tries >= 1 && f.tries <= 300);
    }
    assert.ok(fallbacks <= 2, `${cfg.players}p ${cfg.cak ? 'C&K' : 'base'}: ${fallbacks} levels found no board in band within 300 seeds`);
  }
});

test('a stage reports whether its actual board fits the intended difficulty, including inclusive boundaries', () => {
  assert.equal(setupStage(stageFor(1), 42).fitsDifficulty, false, 'a small gap does not fit clear-favourite practice');
  assert.equal(setupStage(stageFor(15), 74).fitsDifficulty, false, 'a 3.02-point gap is outside a 0.3-point near-tie band');
  assert.equal(setupStage(stageFor(15), 1).fitsDifficulty, true);
  assert.equal(setupStage(stageFor(10), 74).fitsDifficulty, true, 'an unconstrained stage accepts the board');
  const stage = stageFor(15), { margin } = setupStage(stage, 1);
  assert.equal(setupStage({ ...stage, board: { minMargin: margin, maxMargin: margin } }, 1).fitsDifficulty, true);
});

test('exhausting the bounded seed search returns an honestly classified board without extra attempts', () => {
  let calls = 0;
  const stage = stageFor(15);
  const result = findSeed(stage, () => { calls++; return 74; }, 3);
  assert.deepEqual(result, { seed: 74, tries: 3, fallback: true });
  assert.equal(calls, 3);
  assert.equal(setupStage(stage, result.seed).fitsDifficulty, false);
});

test('a displayed 0.30-point gap belongs to the inclusive near-tie band despite binary decimal noise', () => {
  const stage = stageFor(15), result = setupStage(stage, 25);
  assert.equal(result.ranking[0].score, 12.13);
  assert.equal(result.ranking[1].score, 11.83);
  assert.ok(result.ranking[0].score - result.ranking[1].score > .3, 'the raw subtraction still exposes the rounding edge case');
  assert.equal(result.margin, 0.3);
  assert.equal(result.fitsDifficulty, true);
  assert.deepEqual(findSeed(stage, () => 25, 1), { seed: 25, tries: 1, fallback: false });
});

test('judge: pass when the pick ranks within the stage rule, fail otherwise, and says why', () => {
  const st = stageFor(1, { players: 4, cak: false });   // top 3
  const r = setupStage(st, 7);
  const g1 = grade(r.ranking[0], r.ranking, st.players), g3 = grade(r.ranking[2], r.ranking, st.players), g4 = grade(r.ranking[3], r.ranking, st.players);
  assert.equal(judge(st, g1).pass, true); assert.equal(judge(st, g3).pass, true); assert.equal(judge(st, g4).pass, false);
  assert.match(judge(st, g4).text, /top 3/);
  const hard = stageFor(STAGES.length, { players: 4, cak: false });        // exactly #1
  assert.equal(judge(hard, g1).pass, true); assert.equal(judge(hard, g3).pass, false);
  assert.match(judge(hard, g3).text, /best corner/);
});

test('an unavailable corner never clears a drill stage, including empty and short rankings', () => {
  for (const cfg of CONFIGS) for (let n = 1; n <= STAGES.length; n++) {
    const stage = stageFor(n, cfg);
    for (const ranking of [[], [{ id: 0, score: 10 }], [{ id: 0, score: 10 }, { id: 1, score: 9 }]]) {
      const result = judge(stage, grade({ id: 9999, score: 99 }, ranking, cfg.players));
      assert.equal(result.pass, false);
      assert.match(result.text, /not in the current legal ranking/);
      assert.doesNotMatch(result.text, /best corner\.|clears it|Rank/);
    }
  }
});

test('near-tie drill feedback reports the real gap and distinguishes the model target from playing strength', () => {
  const stage = stageFor(15, { players: 4, cak: false });
  const { ranking } = setupStage(stage, 57);
  const pick = ranking.find(r => r.id === 30);
  assert.equal(ranking[0].score, 11.84);
  assert.equal(pick.score, 11.82);
  assert.equal(Math.round(pick.score / ranking[0].score * 100), 100, 'whole-percent rounding would hide this non-tie');
  const result = judge(stage, grade(pick, ranking, 4));
  assert.equal(result.pass, false, 'the exact-best exercise keeps its stated target');
  assert.match(result.text, /0\.02 points/);
  assert.match(result.text, /close model score/i);
  assert.doesNotMatch(result.text, /100%/);
});

test('drill feedback can explain a signed score using its point gap without inventing a share', () => {
  const ranking = [{ id: 0, score: 0 }, { id: 1, score: -.2 }];
  const result = judge(stageFor(5, { players: 4, cak: false }), grade(ranking[1], ranking, 4));
  assert.equal(result.pass, false);
  assert.match(result.text, /Rank 2 of 2/);
  assert.match(result.text, /0\.20 points below/);
  assert.doesNotMatch(result.text, /%|null|close model/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, TABLES, ladderKey, stageFor, findSeed, setupStage, judge } from '../public/drill.js';
import { grade } from '../public/score.js';
import { legalVertices } from '../public/geometry.js';

const CONFIGS = [];
for (const players of [3, 4, 5, 6]) for (const cak of [false, true]) CONFIGS.push({ players, cak });

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

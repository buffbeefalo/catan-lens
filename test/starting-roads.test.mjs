// Starting-road grading (R13): the shared direction evaluation, the grade rules, and proof against a frozen copy
// of the original scorer that settlement scores, rankings and suggested roads are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateBoard, boardFrom } from '../public/board.js';
import { rankSpots, grade, simulateDraft, suggestRoad, roadOptions, gradeRoad, withinTenth, placementContext } from '../public/score.js';
import * as before from './fixtures/score-before-starting-roads.mjs';

const S = (o = {}) => ({ players: 4, seat: 1, cak: false, ...o });
const DEAD_END = /No road makes progress|already taken|dead end/i;   // the phrases e2e/usability.cjs forbids too

// Each settlement the projected opening gives a seat, with the pieces that were down when it went down.
function* openings({ seeds, players }) {
  for (let seed = 1; seed <= seeds; seed++) for (let seat = 1; seat <= players; seat++) {
    const settings = S({ players, seat }), board = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed });
    const draft = simulateDraft(board, settings), mine = draft.filter(d => d.you).map(d => d.id);
    for (const [i, vid] of mine.entries()) {
      yield { seed, settings, board, vid, context: { mine: mine.slice(0, i), occupied: draft.slice(0, draft.findIndex(d => d.you && d.id === vid)).map(d => d.id) } };
    }
  }
}
// The pieces down before `vid` when the projected opening places it.
function turnOf(board, settings, vid) {
  const draft = simulateDraft(board, settings), mine = draft.filter(d => d.you).map(d => d.id);
  return { mine: mine.slice(0, mine.indexOf(vid)), occupied: draft.slice(0, draft.findIndex(d => d.you && d.id === vid)).map(d => d.id) };
}

test('the frozen reference is the original scorer, unedited apart from its two import paths', () => {
  const text = readFileSync(new URL('./fixtures/score-before-starting-roads.mjs', import.meta.url), 'utf8');
  const original = text.split('\n').filter(line => !line.startsWith('// FIXTURE:')).join('\n')
    .replace("from '../../public/board.js';", "from './board.js';").replace("from '../../public/geometry.js';", "from './geometry.js';");
  assert.equal(createHash('sha256').update(original).digest('hex'), '9cea6ba135ed7ef0e6c148bbc8f29cd70297ffe84d2bf772b5926cd9c2c3801c');
});

test('suggested roads, settlement scores and rankings match the original scorer (300 seeds, 4 seats, 2 settlements)', () => {
  let n = 0;
  for (const { board, settings, vid, context } of openings({ seeds: 300, players: 4 })) {
    assert.deepEqual(suggestRoad(board, settings, vid, context), before.suggestRoad(board, settings, vid, context));
    assert.deepEqual(rankSpots(board, settings, context), before.rankSpots(board, settings, context));
    n++;
  }
  assert.equal(n, 2400);
});

test('contested and empty road evaluations match the original scorer too', () => {
  const contested = [generateBoard({ seed: 4 }), S({ seat: 4 }), 32, { mine: [8], occupied: [2, 44, 42, 8] }];
  assert.equal(roadOptions(...contested).contested, true);
  assert.match(suggestRoad(...contested).text, /Every direction is contested/);
  assert.deepEqual(suggestRoad(...contested), before.suggestRoad(...contested));
  const empty = [generateBoard({ seed: 4 }), S({ seat: 4 }), 32, { mine: [8], occupied: [2, 44, 42, 8, 33, 18, 30] }];
  assert.equal(suggestRoad(...empty), null);
  assert.equal(before.suggestRoad(...empty), null);
});

test('every suggested road grades Great with the same inputs, and only genuine ties share it', () => {
  let roads = 0;
  const check = ({ board, settings, vid, context }) => {
    const suggested = suggestRoad(board, settings, vid, context);
    const { directions } = roadOptions(board, settings, vid, context);
    assert.deepEqual(directions.map(d => d.via), board.graph.vertices[vid].neighbors.filter(n => !context.occupied.includes(n)), 'every free side is a direction, target or not');
    for (const d of directions) {
      const g = gradeRoad(board, settings, vid, d.edge, context); roads++;
      assert.doesNotMatch(`${g.why} ${g.detail || ''}`, DEAD_END);
      if (!suggested) { assert.deepEqual([g.tier, g.rank], ['none', null], 'no grade when no direction has a two-road target'); continue; }
      if (d.edge === suggested.edge) assert.equal(g.tier, 'great', 'the suggested side always grades Great');
      if (g.tier === 'great') assert.deepEqual([d.targets[0].score, d.targets.length], [suggested.target.score, suggested.options], 'Great needs the same target score and the same number of options');
      else assert.ok(!d.targets.length || d.targets[0].score < suggested.target.score || d.targets.length < suggested.options);
    }
    assert.equal(gradeRoad(board, settings, vid, board.graph.edges.findIndex(e => !e.v.includes(vid)), context), null, 'only a side of the settlement can hold its road');
    assert.equal(gradeRoad(board, settings, vid, -1, context), null);
  };
  for (const o of openings({ seeds: 300, players: 4 })) check(o);
  for (const players of [3, 5, 6]) for (const o of openings({ seeds: 40, players })) check(o);
  assert.ok(roads > 7000);
});

test('exact ties share Great; a target 0.01 lower is a near tie, not a tie', () => {
  const b = generateBoard({ seed: 29 }), settings = S({ players: 3, seat: 3 });
  assert.equal(suggestRoad(b, settings, 8).edge, 8);
  for (const edge of [8, 14]) assert.equal(gradeRoad(b, settings, 8, edge).tier, 'great');
  const nb = generateBoard({ seed: 134 }), ns = S({ seat: 2 });   // side 8's best target scores 8.99 against 9.00
  const g = gradeRoad(nb, ns, 8, 8, turnOf(nb, ns, 8));
  assert.deepEqual([g.tier, g.rank, g.gap, g.target.score], ['fair', 2, 0.01, 8.99]);
  assert.match(g.why, /^its best target scores 99\.88% of the best direction’s, 0\.01 points lower\.$/);
});

test('an equally good target with fewer open corners that way ranks below, and says so', () => {
  const b = generateBoard({ seed: 73 });
  assert.equal(suggestRoad(b, S(), 3).edge, 2);                    // two corners lie that way
  const g = gradeRoad(b, S(), 3, 16);                               // one corner that way, scoring the same
  assert.deepEqual([g.tier, g.rank, g.gap], ['fair', 2, 0]);
  assert.match(g.why, /ties the best direction’s, but fewer open corners lie this way/);
});

test('the Fair line is the settlement grades’ 90% line whenever the best score is positive', () => {
  // grade() on a one-player table: a pick below the best is Fair at 90% of it or more, otherwise Weak.
  const settlementFair = (best, pick) => grade({ id: 1 }, [{ id: 0, score: best / 100 }, { id: 1, score: pick / 100 }], 1).tier === 'fair';
  let checked = 0;
  for (let best = 1; best <= 3000; best++) {
    const edge = Math.ceil(best * 0.9);
    for (const pick of new Set([0, edge - 1, edge, edge + 1, best - 1].filter(x => x >= 0 && x < best))) {
      assert.equal(withinTenth(best, pick), settlementFair(best, pick), `best ${best}, chosen ${pick} (hundredths)`); checked++;
    }
  }
  assert.ok(checked > 10000);
  assert.equal(withinTenth(1000, 900), true, 'exactly on the line');
  assert.equal(withinTenth(1000, 899), false, 'one hundredth below it');
  assert.equal(withinTenth(-100, -105), true, 'a negative best still has a band a tenth of its size');
  assert.equal(withinTenth(-100, -115), false);
});

test('zero scores compare too: an equal zero target with fewer corners is Fair, not Weak', () => {
  // A legal custom board that is desert apart from one wheat hex: corners away from the wheat score 0.
  const b = boardFrom({ setup: 'base', hexes: Array.from({ length: 19 }, (_, i) => i === 0 ? { resource: 'wheat', number: 6 } : { resource: 'desert' }) });
  assert.equal(suggestRoad(b, S(), 13).edge, 24);                  // two corners lie that way
  const g = gradeRoad(b, S(), 13, 13);                              // one corner that way, also scoring 0
  assert.deepEqual([g.target.score, g.tier, g.rank, g.gap, g.pct], [0, 'fair', 2, 0, null]);
  assert.match(g.why, /ties the best direction’s, but fewer open corners lie this way/);
});

test('a road with no target is Weak and says why: blocked by the projection, or no legal site at all', () => {
  const b = generateBoard({ seed: 1 });
  const blocked = gradeRoad(b, S(), 43, 57);
  assert.deepEqual([blocked.tier, blocked.target], ['weak', null]);
  assert.match(blocked.why, /taken or blocked by another seat in the projected opening/);
  assert.match(blocked.detail, /^The 12-pip corner \(8 wood, 4 brick\) this way is taken or blocked/);
  assert.equal(gradeRoad(b, S(), 43, 56).tier, 'great');
  const absent = gradeRoad(b, S({ seat: 2 }), 50, 66, { mine: [33], occupied: [43, 33, 2, 41, 38, 29] });
  assert.deepEqual([absent.tier, absent.detail], ['weak', null]);
  assert.equal(absent.why, 'no legal settlement site is open two roads this way. Longer routes are not checked.');
  for (const r of [blocked, absent]) assert.doesNotMatch(r.why + (r.detail || ''), DEAD_END);
});

test('with no target in any direction there is no grade, only the two-road limit', () => {
  const g = generateBoard({ seed: 3 }), vid = 0;
  const twoAway = new Set();
  for (const n of g.graph.vertices[vid].neighbors) for (const nn of g.graph.vertices[n].neighbors) if (nn !== vid) twoAway.add(nn);
  const none = gradeRoad(g, S(), vid, g.graph.vertices[vid].edges[0], { occupied: [...twoAway] });
  assert.deepEqual([none.tier, none.label, none.rank, none.target], ['none', 'No two-road target', null, null]);
  assert.equal(none.why, 'no direction from this settlement has an open settlement site two roads away. Longer routes are not checked.');
});

test('revealed road text keeps the contested and own-second-settlement qualifications', () => {
  const contested = gradeRoad(generateBoard({ seed: 4 }), S({ seat: 4 }), 32, 40, { mine: [8], occupied: [2, 44, 42, 8] });
  assert.match(contested.detail, /Every direction is contested in the projected opening, so this compares the corners open now\.$/);
  const own = gradeRoad(generateBoard({ seed: 1 }), S({ seat: 4 }), 41, 54, { mine: [], occupied: [43, 33, 2] });
  assert.equal(own.tier, 'great');
  assert.match(own.detail, /^Your road points toward the 10-pip corner \(1 sheep, 5 wood, 4 wheat\)\. 2 open corners lie that way\. The opening projection also uses this target for your second settlement/);
});

test('the placement context reads the history up to the settlement, skips roads, and is null for a settlement with no entry', () => {
  const history = [{ k: 'opp', id: 2 }, { k: 'me', id: 8, user: true }, { k: 'road', id: 11, at: 8, to: 9 }, { k: 'opp', id: 30 }, { k: 'me', id: 32, user: true }];
  assert.deepEqual(placementContext(history, 8), { mine: [], occupied: [2] });
  assert.deepEqual(placementContext(history, 32), { mine: [8], occupied: [2, 8, 30] }, 'a road is not a settlement');
  assert.deepEqual(placementContext([{ k: 'me', id: 5 }], 5), { mine: [], occupied: [] }, 'a first settlement has a valid, empty position');
  assert.equal(placementContext(history, 30), null, 'an opponent mark is not your settlement');
  assert.equal(placementContext(history, 44), null, 'a settlement missing from the history gets no position, never a truncated one');
  assert.equal(placementContext([], 5), null);
});

test('drawn road advice never drifts: through every later placement each kept settlement keeps the road it was given when kept, and that road grades Great', () => {
  // The drift scenarios: seeds 1-150, 3 and 4 players, every seat, every player placing as projected. "Given" is
  // what the published app drew right after Keep: the original scorer on the board as it stood then.
  let settlements = 0, publishedDrifts = 0;
  for (let seed = 1; seed <= 150; seed++) for (const players of [3, 4]) for (let seat = 1; seat <= players; seat++) {
    const settings = S({ players, seat }), board = generateBoard({ setup: 'base', seed });
    const history = [], mine = [], all = [], given = new Map();
    for (const d of simulateDraft(board, settings)) {
      history.push({ k: d.you ? 'me' : 'opp', id: d.id }); all.push(d.id);
      if (d.you) { mine.push(d.id); given.set(d.id, { position: placementContext(history, d.id), road: before.suggestRoad(board, settings, d.id, { mine: [...mine], occupied: [...all] }) }); }
      for (const [vid, g] of given) assert.deepEqual(placementContext(history, vid), g.position, `seed ${seed}, ${players} players, seat ${seat}: corner ${vid}'s position changed after a later placement`);
    }
    for (const [vid, g] of given) {
      if (!g.road) continue;
      settlements++;
      const position = placementContext(history, vid), road = suggestRoad(board, settings, vid, position);
      assert.deepEqual(road, g.road, `seed ${seed}, ${players} players, seat ${seat}: corner ${vid}'s drawn road drifted`);
      assert.equal(gradeRoad(board, settings, vid, road.edge, position).tier, 'great');
      if (suggestRoad(board, settings, vid, { mine, occupied: all })?.edge !== g.road.edge) publishedDrifts++;
    }
  }
  assert.deepEqual([settlements, publishedDrifts], [2094, 322], 'the published live-board drawing moves for 322 of these settlements by the end of setup');
});

test('listing the settlement itself in its position changes no road advice or grade', () => {
  // roadOptions adds the settlement to both lists first, so "pieces before it" and "pieces before it, then it"
  // give the same suggestion and the same grade on every side (seeds 1-25, 3-6 players, every seat).
  let compared = 0;
  for (let seed = 1; seed <= 25; seed++) for (const players of [3, 4, 5, 6]) for (let seat = 1; seat <= players; seat++) {
    const settings = S({ players, seat }), board = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed });
    const history = simulateDraft(board, settings).map(d => ({ k: d.you ? 'me' : 'opp', id: d.id }));
    for (const { id: vid } of history.filter(h => h.k === 'me')) {
      const before = placementContext(history, vid), withIt = { mine: [...before.mine, vid], occupied: [...before.occupied, vid] };
      assert.deepEqual(suggestRoad(board, settings, vid, withIt), suggestRoad(board, settings, vid, before), `seed ${seed}, ${players} players, seat ${seat}, corner ${vid}`);
      for (const edge of board.graph.vertices[vid].edges) assert.deepEqual(gradeRoad(board, settings, vid, edge, withIt), gradeRoad(board, settings, vid, edge, before));
      compared++;
    }
  }
  assert.equal(compared, 900);
});

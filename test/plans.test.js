// Strategy modes: a plan chosen for your own seat changes your scores only. The other seats keep the seat rule
// (R10) in every projection, so choosing a plan never changes what the model expects them to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard } from '../public/board.js';
import { planFor, rankSpots, simulateDraft, PLANS, PLAN_CHOICES } from '../public/score.js';
import { rankLookahead } from '../public/lookahead.js';

const S = (o = {}) => ({ players: 4, seat: 1, cak: false, ...o });

test('a chosen plan applies to your seat; no choice keeps the seat rule; Cities & Knights keeps its own weighting', () => {
  assert.deepEqual(PLAN_CHOICES, ['ows', 'road']);
  assert.equal(planFor(S({ seat: 1 })), 'ows');
  assert.equal(planFor(S({ seat: 1, plan: 'road' })), 'road');
  assert.equal(planFor(S({ seat: 4, plan: 'ows' })), 'ows');
  assert.equal(planFor(S({ seat: 4, plan: 'auto' })), 'road');
  assert.equal(planFor(S({ seat: 4, plan: 'nonsense' })), 'road', 'an unknown value falls back to the seat rule');
  assert.equal(planFor(S({ seat: 1, plan: 'road', cak: true })), 'cak');
});

test('the Roads plan values wood and brick more than the Cities plan, for the same corner', () => {
  const b = generateBoard({ seed: 6 });
  const woodBrick = rankSpots(b, S()).find(r => r.prod.wood && r.prod.brick && !r.prod.wheat && !r.prod.ore);
  assert.ok(woodBrick, 'seed 6 has a wood and brick corner without wheat or ore');
  const roads = rankSpots(b, S({ plan: 'road' })).find(r => r.id === woodBrick.id);
  assert.ok(roads.score > woodBrick.score);
  assert.equal(roads.plan, 'road');
  assert.ok(PLANS.road.weights.wood > PLANS.ows.weights.wood && PLANS.road.weights.ore < PLANS.ows.weights.ore);
});

test("your plan never changes another seat's projected picks", () => {
  for (const seed of [2, 5, 9]) {
    const b = generateBoard({ seed });
    const draft = simulateDraft(b, S({ seat: 2 }));
    const me = draft.filter(d => d.you).map(d => d.id);
    for (const plan of ['ows', 'road']) {
      const withPlan = simulateDraft(b, S({ seat: 2, plan }), { me });
      assert.deepEqual(withPlan.filter(d => !d.you).map(d => [d.seat, d.id]), draft.filter(d => !d.you).map(d => [d.seat, d.id]), `seed ${seed} ${plan}`);
    }
  }
});

test('the look-ahead uses your chosen plan for your own corners and the seat rule for everyone else', () => {
  const b = generateBoard({ seed: 5 });
  const auto = rankLookahead(b, S({ seat: 1 }), { me: [], opp: [] }), roads = rankLookahead(b, S({ seat: 1, plan: 'road' }), { me: [], opp: [] });
  assert.ok(roads.every(r => r.plan === 'road') && auto.every(r => r.plan === 'ows'));
  // Each other seat's projected pick is the seat-rule model's top for that seat at that moment.
  const top = roads[0], occupied = [top.id], firsts = {};
  for (const d of top.projection) {
    if (!d.you && !d.actual) assert.equal(d.id, rankSpots(b, S({ seat: d.seat }), { mine: d.round === 2 ? [firsts[d.seat]] : [], occupied })[0].id);
    if (d.round === 1) firsts[d.seat] = d.id;
    if (!occupied.includes(d.id)) occupied.push(d.id);
  }
});

// Deterministic opening report: `node bench/production-report.mjs [boards]`.
// For fixed seeds and every seat of a 4-player base game, each policy picks both opening settlements
// from the same situation: the seats before you take their projected picks, you pick, the draft runs on
// to your second turn, you pick again. Then we measure the opening you end up with.
//   lens    Catan Lens's ranking (its second pick complements the first)
//   pips    the open corner with the most pips (ties: lowest corner id)
//   random  a uniformly random open corner (seeded)
// Max-pips maximises expected cards per roll by construction, so it SHOULD win that column; the question
// is what the other columns show. No game is played here: see catanatron_bench.py for full games.
import { generateBoard, PIPS, RESOURCES, rng } from '../public/board.js';
import { legalVertices } from '../public/geometry.js';
import { rankSpots, simulateDraft } from '../public/score.js';

const BOARDS = Number(process.argv[2]) || 500;
const pipsAt = (b, v) => b.graph.vertices[v].hexes.reduce((s, h) => s + (b.hexes[h].number ? PIPS[b.hexes[h].number] : 0), 0);

function pick(policy, b, settings, mine, occupied, rand) {
  const legal = legalVertices(b.graph, occupied);
  if (policy === 'random') return legal[Math.floor(rand() * legal.length)];
  if (policy === 'pips') return legal.reduce((a, v) => (pipsAt(b, v) > pipsAt(b, a) ? v : a));
  return rankSpots(b, settings, { mine, occupied })[0].id;
}

function opening(policy, b, settings, rand) {
  const N = settings.players, S = settings.seat;
  // Seats before you, then your first pick.
  const before = simulateDraft(b, settings).slice(0, S - 1).map(d => d.id);
  const first = pick(policy, b, settings, [], before, rand);
  // The draft runs on with your first settlement fixed; stop at your second turn.
  const draft = simulateDraft(b, settings, { me: [first], opp: before });
  const mySecondSlot = N + (N - S);
  const others = draft.slice(0, mySecondSlot).filter(d => !d.you).map(d => d.id);
  const second = pick(policy, b, settings, [first], [first, ...others], rand);
  return [first, second];
}

function measure(b, ids) {
  const prod = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  const numbers = new Set();
  for (const v of ids) for (const h of b.graph.vertices[v].hexes) {
    const x = b.hexes[h];
    if (!x.number) continue;
    prod[x.resource] += PIPS[x.number];
    numbers.add(x.number);
  }
  const pips = Object.values(prod).reduce((s, x) => s + x, 0);
  return { cards: pips / 36, prod, covered: RESOURCES.filter(r => prod[r] > 0).length, spread: numbers.size, cityPair: Math.min(prod.wheat, prod.ore) };
}

const POLICIES = ['lens', 'pips', 'random'];
const sum = Object.fromEntries(POLICIES.map(p => [p, { n: 0, cards: 0, covered: 0, all5: 0, spread: 0, cityPair: 0, prod: Object.fromEntries(RESOURCES.map(r => [r, 0])) }]));
for (let seed = 1; seed <= BOARDS; seed++) {
  const b = generateBoard({ setup: 'base', seed, balanced: true });
  for (let seat = 1; seat <= 4; seat++) {
    const settings = { players: 4, seat, cak: false };
    for (const p of POLICIES) {
      const m = measure(b, opening(p, b, settings, rng(seed * 10 + seat)));
      const s = sum[p];
      s.n++; s.cards += m.cards; s.covered += m.covered; s.all5 += m.covered === 5; s.spread += m.spread; s.cityPair += m.cityPair;
      for (const r of RESOURCES) s.prod[r] += m.prod[r];
    }
  }
}

const f = (x, d = 2) => x.toFixed(d);
console.log(`Opening report: ${BOARDS} balanced base boards (seeds 1-${BOARDS}) x 4 seats; both settlements per policy.\n`);
console.log('| Policy | Cards per roll | Resources covered (of 5) | All five covered | Different numbers | Wheat/ore pair (pips of the weaker) | Pips: wood / brick / wheat / sheep / ore |');
console.log('|---|---|---|---|---|---|---|');
for (const p of POLICIES) {
  const s = sum[p];
  console.log(`| ${p} | ${f(s.cards / s.n)} | ${f(s.covered / s.n)} | ${f(100 * s.all5 / s.n, 0)}% | ${f(s.spread / s.n)} | ${f(s.cityPair / s.n)} | ${RESOURCES.map(r => f(s.prod[r] / s.n, 1)).join(' / ')} |`);
}

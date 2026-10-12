// Draft diagnostics: `node bench/draft-diagnostics.mjs [boards]`. Seeded and deterministic.
// Reproduces two findings from an outside review of the classic (greedy) ranking:
//   1. Greedy first picks. For each seat, the earlier seats' projected first picks are placed. The greedy
//      plan takes the top-ranked corner, then the second settlement the projected draft leaves you. The
//      best plan tries every legal first corner and keeps the one whose own score plus its projected
//      second's score is highest. How often do they differ, and by how many points?
//   2. Room to grow (R8). For the greedy first corner, is the corner R8 credits (the best legal corner two
//      roads away, by pips) still legal once the projected opening draft has finished?
// Internal diagnostics only: nothing here plays a game or measures winning chances.
import { generateBoard, PIPS } from '../public/board.js';
import { legalVertices } from '../public/geometry.js';
import { rankSpots, simulateDraft } from '../public/score.js';

const BOARDS = Number(process.argv[2]) || 200;
const PLAYERS = 4;
const pipsAt = (b, v) => b.graph.vertices[v].hexes.reduce((s, h) => s + (b.hexes[h].number ? PIPS[b.hexes[h].number] : 0), 0);

// The corner R8 credits, found exactly as scoreVertex does: neighbours, then their neighbours, keeping
// the first corner with the most pips among those still legal after this settlement.
function r8Target(b, vid, occupied) {
  const after = new Set(legalVertices(b.graph, [...occupied, vid]));
  let best = null;
  for (const n of b.graph.vertices[vid].neighbors) for (const nn of b.graph.vertices[n].neighbors) {
    if (nn === vid || !after.has(nn)) continue;
    const p = pipsAt(b, nn);
    if (!best || p > best.pips) best = { id: nn, pips: p };
  }
  return best;
}

// Score of my projected second settlement after placing `first`, with `before` already down.
function projectedSecond(b, settings, first, before) {
  const d = simulateDraft(b, settings, { me: [first], opp: before }).find(x => x.you && x.round === 2);
  return d ? { id: d.id, score: d.score } : null;
}

const perSeat = Array.from({ length: PLAYERS }, () => ({ cases: 0, differ: 0, gain: 0, maxGain: 0, worstOwnLoss: 0, ownLoss: 0, baseRankMax: 0 }));
const r8 = { cases: 0, withTarget: 0, lost: 0, byMySecond: 0 };
const t0 = performance.now();
let lookaheadMs = 0;
for (let seed = 1; seed <= BOARDS; seed++) {
  const b = generateBoard({ setup: 'base', seed, balanced: true });
  for (let seat = 1; seat <= PLAYERS; seat++) {
    const settings = { players: PLAYERS, seat, cak: false };
    const before = simulateDraft(b, settings).filter(d => d.round === 1 && d.seat < seat).map(d => d.id);
    const ranking = rankSpots(b, settings, { mine: [], occupied: before });
    const greedy = ranking[0];
    const t1 = performance.now();
    let best = null;
    ranking.forEach((c, baseRank) => {
      const second = projectedSecond(b, settings, c.id, before);
      const value = c.score + (second ? second.score : 0);
      if (!best || value > best.value + 1e-9) best = { id: c.id, own: c.score, value, baseRank: baseRank + 1 };
    });
    lookaheadMs += performance.now() - t1;
    const gSecond = projectedSecond(b, settings, greedy.id, before);
    const greedyValue = greedy.score + (gSecond ? gSecond.score : 0);
    const s = perSeat[seat - 1];
    s.cases++;
    if (best.id !== greedy.id) {
      const gain = best.value - greedyValue, ownLoss = greedy.score - best.own;
      s.differ++; s.gain += gain; s.maxGain = Math.max(s.maxGain, gain);
      s.ownLoss += ownLoss; s.worstOwnLoss = Math.max(s.worstOwnLoss, ownLoss);
      s.baseRankMax = Math.max(s.baseRankMax, best.baseRank);
    }
    // Finding 2 on the same cases (and more boards below when BOARDS is small).
    const target = r8Target(b, greedy.id, before);
    r8.cases++;
    if (target) {
      r8.withTarget++;
      const end = simulateDraft(b, settings, { me: [greedy.id], opp: before });
      const occupiedAtEnd = end.map(d => d.id);
      if (!legalVertices(b.graph, occupiedAtEnd).includes(target.id)) {
        r8.lost++;
        // Would it have survived without my own projected second settlement?
        const others = end.filter(d => !(d.you && d.round === 2)).map(d => d.id);
        if (legalVertices(b.graph, others).includes(target.id)) r8.byMySecond++;
      }
    }
  }
}
const pct = (a, n) => (n ? (100 * a / n).toFixed(1) : '0.0');
console.log(`Draft diagnostics: ${BOARDS} balanced base boards (seeds 1 to ${BOARDS}), 4 players, base-game weights.\n`);
console.log('Finding 1: greedy first pick versus the best first pick with its projected second settlement.');
console.log('| Seat | Cases | Different first pick | Average gain when different | Largest gain | Average own-corner score given up | Worst | Lowest base rank chosen |');
console.log('|---|---|---|---|---|---|---|---|');
perSeat.forEach((s, i) => console.log(`| ${i + 1} | ${s.cases} | ${pct(s.differ, s.cases)}% | ${s.differ ? (s.gain / s.differ).toFixed(2) : '0.00'} | ${s.maxGain.toFixed(2)} | ${s.differ ? (s.ownLoss / s.differ).toFixed(2) : '0.00'} | ${s.worstOwnLoss.toFixed(2)} | ${s.baseRankMax || '-'} |`));
console.log(`\nFinding 2: R8 target of the greedy first corner taken or blocked by the end of the projected draft: ${r8.lost} of ${r8.withTarget} cases with a target (${pct(r8.lost, r8.withTarget)}%); ${r8.cases - r8.withTarget} cases had no target.`);
console.log(`  Lost only because of my own projected second settlement: ${r8.byMySecond} (${pct(r8.byMySecond, r8.withTarget)}%). Lost to the other seats: ${r8.lost - r8.byMySecond} (${pct(r8.lost - r8.byMySecond, r8.withTarget)}%).`);
console.log(`\nTiming (Node, this machine): full lookahead over every legal first corner averaged ${(lookaheadMs / (BOARDS * PLAYERS)).toFixed(1)} ms per seat; whole run ${((performance.now() - t0) / 1000).toFixed(1)} s.`);

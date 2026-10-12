// Look-ahead diagnostics: `node bench/lookahead-diagnostics.mjs [boards]`. Seeded and deterministic (apart from the
// timings). Measures the experimental look-ahead ranking (public/lookahead.js) against the classic ranking from the
// same positions: for each seat of a four-player base game, the earlier seats' projected first picks are placed, then
//   - how often the look-ahead's first pick differs from the classic top corner;
//   - the classic score and raw pips it gives up for a better opening (mean and worst), and the lowest classic rank
//     it chooses;
//   - how often its second pick, at the second turn of the same projected draft, differs from the classic one.
// Then times the first-pick ranking for 3 to 6 players. Internal diagnostics only: no game is played, and nothing
// here measures winning chances.
import { generateBoard, PIPS } from '../public/board.js';
import { rankSpots, simulateDraft } from '../public/score.js';
import { rankLookahead, POLICY } from '../public/lookahead.js';

const BOARDS = Number(process.argv[2]) || 200;
const pipsAt = (b, v) => b.graph.vertices[v].hexes.reduce((s, h) => s + (b.hexes[h].number ? PIPS[b.hexes[h].number] : 0), 0);
const pct = (n, d) => `${(100 * n / d).toFixed(1)}%`;

const seats = [1, 2, 3, 4].map(seat => ({ seat, n: 0, differs: 0, givenUp: [], pipsUp: [], worstRank: 1, second: 0, secondDiffers: 0 }));
for (let seed = 1; seed <= BOARDS; seed++) {
  const b = generateBoard({ setup: 'base', seed, balanced: true });
  for (const s of seats) {
    const settings = { players: 4, seat: s.seat, cak: false };
    const before = simulateDraft(b, settings).slice(0, s.seat - 1).map(d => d.id);
    const classic = rankSpots(b, settings, { mine: [], occupied: before, explain: false });
    const la = rankLookahead(b, settings, { me: [], opp: before })[0];
    const rank = classic.findIndex(c => c.id === la.id);
    s.n++;
    if (la.id !== classic[0].id) s.differs++;
    s.givenUp.push(classic[0].score - classic[rank].score);
    s.pipsUp.push(pipsAt(b, classic[0].id) - pipsAt(b, la.id));
    s.worstRank = Math.max(s.worstRank, rank + 1);
    // The second turn of the look-ahead's own projected draft: same position for both rankings.
    const mySecond = la.projection.findIndex(d => d.you && d.round === 2);
    if (mySecond < 0) continue;
    const occupied = la.projection.slice(0, mySecond).map(d => d.id);
    const opp = occupied.filter(v => v !== la.id);
    const c2 = rankSpots(b, settings, { mine: [la.id], occupied, explain: false })[0];
    const l2 = rankLookahead(b, settings, { me: [la.id], opp })[0];
    if (c2 && l2) { s.second++; if (c2.id !== l2.id) s.secondDiffers++; }
  }
}

const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length;
console.log(`Look-ahead diagnostics (${POLICY}): ${BOARDS} balanced base boards (seeds 1 to ${BOARDS}), four players.\n`);
console.log('| Seat | First pick differs from classic | Classic score given up: mean / worst | Raw pips given up: mean / worst | Lowest classic rank chosen | Second pick differs |');
console.log('|---|---|---|---|---|---|');
for (const s of seats) {
  console.log(`| ${s.seat} | ${pct(s.differs, s.n)} | ${mean(s.givenUp).toFixed(2)} / ${Math.max(...s.givenUp).toFixed(2)} | ${mean(s.pipsUp).toFixed(2)} / ${Math.max(...s.pipsUp)} | ${s.worstRank} | ${pct(s.secondDiffers, s.second)} |`);
}

// Timing: the first-pick ranking from an empty board, every seat, a fresh board each time (nothing remembered).
console.log('\nTiming (Node, this machine): first-pick look-ahead ranking from an empty board, every seat.');
console.log('| Players | Median ms | Worst ms |');
console.log('|---|---|---|');
for (const players of [3, 4, 5, 6]) {
  const times = [];
  for (let seed = 1; seed <= Math.min(BOARDS, 40); seed++) {
    for (let seat = 1; seat <= players; seat++) {
      const b = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed, balanced: true });
      const t = performance.now();
      rankLookahead(b, { players, seat, cak: false }, { me: [], opp: [] });
      times.push(performance.now() - t);
    }
  }
  times.sort((a, b) => a - b);
  console.log(`| ${players} | ${times[Math.floor(times.length / 2)].toFixed(0)} | ${times[times.length - 1].toFixed(0)} |`);
}

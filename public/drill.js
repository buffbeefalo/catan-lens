// Drill mode: one straight ladder of levels, easy to hard (no worlds, no themes). You choose the TABLE
// before you start — how many players (3–6) and whether Cities & Knights weighting is on — and every
// level runs on that table. Each stage then fixes the scenario (your seat as a position in the order,
// which seats have already placed, first or second settlement) and two dials that ramp: how close to the
// best corner you must land (`pass.top`: rank 3, 2, then exactly 1) and how clear-cut the board is
// (`board.minMargin` / `maxMargin`: the score gap between the top two corners you can choose from — a wide
// gap is an easy read, a near-tie is hard). Boards are found by searching seeds for one that fits the band.
// Presentation layer over score.js; no new scoring rules.
import { generateBoard } from './board.js';
import { rankSpots, simulateDraft } from './score.js';

// Seat positions resolve against the chosen table size, so "last" is seat 3 at a 3-player table and 6 at six.
export const STAGES = [
  { title: 'Clear favourite', position: 'first', task: 'first', pass: { top: 3 }, board: { minMargin: 1.5 } },
  { title: 'Still clear', position: 'first', task: 'first', pass: { top: 3 }, board: { minMargin: 1.0 } },
  { title: 'Narrow it down', position: 'first', task: 'first', pass: { top: 2 }, board: { minMargin: 1.0 } },
  { title: 'Second to pick', position: 'second', task: 'first', pass: { top: 2 }, board: { minMargin: 0.6 } },
  { title: 'Only the best', position: 'first', task: 'first', pass: { top: 1 }, board: { minMargin: 1.0 } },
  { title: 'Second to pick, exact', position: 'second', task: 'first', pass: { top: 1 }, board: { minMargin: 0.6 } },
  { title: 'Middle of the order', position: 'middle', task: 'first', pass: { top: 1 }, board: { minMargin: 0.6 } },
  { title: 'Last to pick', position: 'last', task: 'first', pass: { top: 1 }, board: { minMargin: 0.3 } },
  { title: 'Last to pick, near-tie', position: 'last', task: 'first', pass: { top: 1 }, board: { maxMargin: 0.5 } },
  { title: 'Your second settlement', position: 'last', task: 'second', pass: { top: 1 }, board: {} },
  { title: 'Second settlement, near-tie', position: 'second', task: 'second', pass: { top: 1 }, board: { maxMargin: 0.5 } },
  { title: 'Middle of the order, near-tie', position: 'middle', task: 'first', pass: { top: 1 }, board: { maxMargin: 0.5 } },
  { title: 'Second-to-last, near-tie', position: 'penultimate', task: 'first', pass: { top: 1 }, board: { maxMargin: 0.5 } },
  { title: 'Second settlement from the middle', position: 'middle', task: 'second', pass: { top: 1 }, board: { minMargin: 0.5 } },
  { title: 'Second settlement from the middle, near-tie', position: 'middle', task: 'second', pass: { top: 1 }, board: { maxMargin: 0.3 } },
  { title: 'Second settlement, second-to-last, near-tie', position: 'penultimate', task: 'second', pass: { top: 1 }, board: { maxMargin: 0.3 } },
];

// Every table the drill can be set to; each keeps its own progress track.
export const TABLES = [3, 4, 5, 6].flatMap(players => [false, true].map(cak => ({ players, cak })));
export const ladderKey = t => `${t.players}-${t.cak ? 'cak' : 'base'}`;
export const tableLabel = t => `${t.players} players, ${t.cak ? 'Cities & Knights' : 'base game'}`;

export function resolveSeat(position, players) {
  switch (position) {
    case 'first': return 1;
    case 'second': return Math.min(2, players);
    case 'middle': return Math.ceil((players + 1) / 2);   // 3→2, 4→3, 5→3, 6→4
    case 'penultimate': return Math.max(1, players - 1);
    default: return players;                                // 'last'
  }
}

// Stage n (1-based) on a table. Beyond the ladder the hardest stage repeats with fresh boards.
export function stageFor(n, table = { players: 4, cak: false }) {
  const s = STAGES[Math.min(Math.max(1, n), STAGES.length) - 1];
  return { n, ...s, players: table.players, cak: !!table.cak, seat: resolveSeat(s.position, table.players) };
}

// Build the stage on a given seed: the board, the pieces already down (from the projected draft, so
// they are the corners strong players would take), the ranking you face and its top-two margin.
export function setupStage(stage, seed) {
  const board = generateBoard({ setup: stage.players >= 5 ? 'ext56' : 'base', seed, balanced: true });
  const settings = { players: stage.players, seat: stage.seat, cak: stage.cak };
  const draft = simulateDraft(board, settings);
  const me = [], opp = [];
  if (stage.task === 'first') {
    for (const d of draft) if (d.round === 1 && d.seat < stage.seat) opp.push(d.id);
  } else {
    // Snake order: every seat's first is down, and the seats after you have taken their second.
    for (const d of draft) {
      if (d.round === 1) (d.seat === stage.seat ? me : opp).push(d.id);
      else if (d.seat > stage.seat) opp.push(d.id);
    }
  }
  const ranking = rankSpots(board, settings, { mine: me, occupied: [...me, ...opp] });
  const margin = ranking.length > 1 ? ranking[0].score - ranking[1].score : Infinity;
  return { board, settings, me, opp, ranking, margin };
}

// Search seeds (from `next()`, a 32-bit source) for a board inside the stage's margin band.
export function findSeed(stage, next, maxTries = 120) {
  const { minMargin = -Infinity, maxMargin = Infinity } = stage.board;
  let seed = 0, tries = 0;
  for (; tries < maxTries; ) {
    seed = next() >>> 0; tries++;
    const { margin, ranking } = setupStage(stage, seed);
    if (ranking.length > 1 && margin >= minMargin && margin <= maxMargin) return { seed, tries, fallback: false };
  }
  return { seed, tries, fallback: true };
}

// Did the graded pick clear the stage?
export function judge(stage, g) {
  const top = stage.pass.top;
  const pass = g.rank <= top;
  const need = top === 1 ? 'the best corner' : `one of the top ${top} corners`;
  const text = pass
    ? (g.rank === 1 ? 'You found the best corner.' : `Rank ${g.rank} — inside the top ${top}, that clears it.`)
    : `Rank ${g.rank} of ${g.total} at ${g.pct}% of the best. This stage needs ${need}.`;
  return { pass, text, need };
}

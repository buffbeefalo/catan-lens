// Writes the SYNTHETIC demonstration answer files in this folder: `node study/demo/make-synthetic.mjs`. They exist only
// to show study/analyze.mjs running. A seeded random process makes up every answer: no person reviewed these positions
// and no Catan Lens policy chose any corner. Never put them next to real answer files.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, PIPS } from '../../public/board.js';
import { answerFile, boardOf, openCorners } from '../review.js';
import POSITIONS from '../positions-2026-10-12.json' with { type: 'json' };

const NOTE = 'SYNTHETIC DEMONSTRATION DATA. A script made up these answers to show the analysis running. No person reviewed these positions and no Catan Lens policy chose any corner.';

function pick(rand, items, weight) {
  let t = rand() * items.reduce((s, x) => s + weight(x), 0);
  for (const x of items) if ((t -= weight(x)) < 0) return x;
  return items[items.length - 1];
}

// Made-up answers lean towards corners with more dots on their number tokens (weight: pips cubed, plus one), so the
// demonstration has some agreement to count. The third made-up reviewer skips a few positions.
export function makeSynthetic(data = POSITIONS) {
  return [1, 2, 3].map(k => {
    const rand = rng(7000 + k), answers = {};
    for (const p of data.positions) {
      if (k === 3 && rand() < 0.15) continue;
      const board = boardOf(p);
      const weight = n => board.graph.vertices[n - 1].hexes.reduce((s, h) => s + (board.hexes[h].number ? PIPS[board.hexes[h].number] : 0), 0) ** 3 + 1;
      const open = openCorners(p), choice = pick(rand, open, weight), others = open.filter(n => n !== choice), acceptable = [];
      for (let i = Math.floor(rand() * 4); i > 0; i--) acceptable.push(pick(rand, others, weight));
      const plannedSecond = p.task === 'first' && rand() < 0.5 ? pick(rand, openCorners(p, [choice]), weight) : null;
      answers[p.id] = { choice, plannedSecond, acceptable, confidence: 1 + Math.floor(rand() * 5), reasoning: 'Synthetic answer made up by a script.' };
    }
    const file = answerFile({ data, code: `SYNTHETIC-${k}`, answers, synthetic: true, note: NOTE, now: new Date('2026-10-12T00:00:00Z') });
    return { name: `synthetic-reviewer-${k}.json`, text: JSON.stringify(file, null, 2) + '\n' };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { name, text } of makeSynthetic()) writeFileSync(new URL(name, import.meta.url), text);
  console.log('Wrote the synthetic demonstration files.');
}

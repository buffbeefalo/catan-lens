// The demo videos, scene by scene. Each scene is a line of narration (`say`) and what happens on screen
// while it plays (`act`). The recorder holds every scene for at least its narration's length, so the
// words and the clicks stay together. Corner choices are computed with the app's own scoring code, so
// the videos cannot drift from what the app actually recommends.
import { generateBoard } from '../public/board.js';
import { rankSpots } from '../public/score.js';
import { setupStage, stageFor } from '../public/drill.js';

// Ranking for whatever the page is showing right now, rebuilt from its link.
export function rankingFor(url) {
  const q = new URL(url).searchParams;
  const players = Number(q.get('players')), seat = Number(q.get('seat')), seed = Number(q.get('seed'));
  if (q.get('drill') === '1') {
    const st = stageFor(Number(q.get('level')), { players, cak: q.get('cak') === '1' });
    return setupStage(st, seed).ranking;
  }
  const ids = k => (q.get(k) || '').split(',').filter(Boolean).map(Number);
  const me = ids('me'), opp = ids('opp');
  const board = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed, balanced: q.get('bal') !== '0' });
  return rankSpots(board, { players, seat, cak: q.get('cak') === '1' }, { mine: me.slice(0, 1), occupied: [...me, ...opp] });
}

const corner = id => `#hits .vx.legal[aria-label="Corner ${id}"]`;

export const VIDEOS = [
  {
    id: 'overview',
    title: 'Catan Lens in 90 seconds',
    url: '?seed=42&players=4&seat=1',
    scenes: [
      { say: 'This is Catan Lens: a free, open-source helper for the most important decision in Catan, where to put your first two settlements.', act: async u => { await u.wait(600); } },
      { say: 'Every board follows the official setup. The gold ring marks the strongest open corner, and the card beside the board says what it produces.', act: async u => { await u.hover('#svg .best-ring'); await u.wait(1200); await u.hover('.best-card h2'); } },
      { say: 'Open "Why this corner?" for the reasoning in plain sentences: how much it produces, which resources, and whether they are rare on this board.', act: async u => { await u.click('.best-card summary'); } },
      { say: 'Click any other corner to compare. You get a grade, a share of the best score, and exactly what the best corner has that yours is missing.', act: async u => { await u.click('.best-card summary'); const r = u.ranking(); await u.click(corner(r[8].id)); } },
      { say: 'Take the best corner instead and keep it. The ring jumps to the best second settlement, the one that patches what your first is missing.', act: async u => { await u.click('#cancel-pick'); await u.click('#preview-best'); await u.wait(900); await u.click('#keep'); await u.wait(600); await u.hover('#svg .best-ring'); } },
      { say: 'There is a drill mode with sixteen levels, and you can enter the real board on your table. It all runs in your browser, with no account and no tracking.', act: async u => { await u.hover('#drill'); await u.wait(1400); await u.hover('#custom'); } },
    ],
  },
  {
    id: 'walkthrough',
    title: 'How Catan Lens works',
    url: '?seed=42&players=4&seat=1',
    scenes: [
      { say: 'How does Catan Lens decide? It scores every legal corner with a few rules that strong players agree on, and production comes first.', act: async u => { await u.wait(500); await u.hover('#svg .best-ring'); } },
      { say: 'Each number token has dots. A six or an eight has five, a two or a twelve has one. The dots count the ways two dice can roll that number, out of thirty-six.', act: async u => { await u.hover('#svg .tok-n.red'); await u.wait(2500); await u.hover('#svg .tok-n >> nth=2'); } },
      { say: 'A corner collects from up to three hexes, so its production is the sum of their dots. Wheat and ore count a little more, because they build cities and development cards.', act: async u => { await u.click('.best-card summary'); } },
      { say: 'A resource that is rare on this particular board is worth more. Smaller bonuses go to wood with brick, wheat with ore, a harbour you can feed, and room to grow. Repeating a number costs a little.', act: async u => { await u.hover('.best-card .why'); await u.wait(2500); await u.click('.best-card summary'); } },
      { say: 'Every rule traces back to a published source: expert guides, champion interviews, and a statistical study of four hundred online games.', act: async u => { await u.click('[data-disclosure="method"] summary'); await u.hover('[data-disclosure="method"] a'); } },
      { say: 'Placement is a snake draft. Projected placements plays it out for every seat, so you can see what will probably be gone before your turn comes back. The suggested road avoids corners other players are likely to take first.', act: async u => { await u.click('[data-disclosure="method"] summary'); await u.click('[data-disclosure="draft"] summary'); } },
      { say: 'Drill mode turns this into practice. Set the table first: how many players, and whether you play Cities and Knights. Then climb sixteen levels, easy to hard, with hints hidden until you commit.', act: async u => { await u.click('[data-disclosure="draft"] summary'); await u.click('#drill'); await u.wait(600); await u.click('#settings summary'); await u.wait(800); await u.hover('#players'); await u.wait(600); await u.click('#settings summary'); await u.click('#start-drill'); } },
      { say: 'Miss, and you see your rank and what the level needed, then get a fresh board at the same level.', act: async u => { const r = u.ranking(); await u.click(corner(r[Math.min(12, r.length - 1)].id)); await u.wait(600); await u.click('#keep'); await u.wait(1200); await u.hover('.card.drill .grade'); } },
      { say: 'Hit the best corner, and the level is cleared. Later levels demand the exact best corner on near-ties, from any seat, and for your second settlement too.', act: async u => { await u.click('#scramble'); const r = u.ranking(); await u.click(corner(r[0].id)); await u.wait(600); await u.click('#keep'); await u.wait(1000); await u.hover('.track'); } },
      { say: 'Playing at a real table? Your board lets you copy it. Pick a resource and tap hexes to paint them, choose Numbers to set tokens, and tap the coast to place harbours.', act: async u => { await u.click('#drill'); await u.click('#custom'); await u.click('#tool-ore'); await u.click('#svg .hex >> nth=4'); await u.click('#tool-number'); await u.click('#svg .hex >> nth=4'); await u.click('.picker button[data-num="6"]'); await u.click('#tool-port'); await u.click('#svg .coast-hit >> nth=3'); await u.click('#tool-port'); } },
      { say: 'Every ranking then applies to your board, and Copy link saves the whole thing so you can share it with your table.', act: async u => { await u.hover('#svg .best-ring'); await u.wait(1500); await u.hover('#share'); } },
      { say: 'Does the advice actually win? In thousands of simulated games between strong bots, openings chosen by Catan Lens won about as often as the bots\' own searched openings, and far more often than just grabbing the most dots.', act: async u => { await u.showResults(); } },
    ],
  },
];

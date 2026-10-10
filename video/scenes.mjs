// The demo videos, scene by scene. Each scene is a line of narration (`say`) and what happens on screen
// while it plays (`act`). `u.focus` moves the camera: a selector (or a list of them) to frame, or 'page'
// for the whole window. The recorder holds every scene for at least its narration's length, so the
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
const BOARD = '#svg', PANEL = '#panel';
const TWO = '#svg .tok-n:text-is("2")';   // the token under the "two" in the narration

export const SITE = 'buffbeefalo.github.io/catan-lens';

export const VIDEOS = [
  {
    id: 'overview',
    url: '?seed=42&players=4&seat=1',
    intro: { title: 'Catan Lens', line: 'Where to place your first two settlements' },
    outro: { say: 'Catan Lens. Free, open source, and ready for your next game.', title: 'Catan Lens', line: 'Free and open source' },
    scenes: [
      { say: 'Your first settlements shape what you can produce and build. Catan Lens helps you compare those choices before the first roll.',
        act: async u => { await u.focus('page'); await u.at('Catan Lens helps'); await u.focus([BOARD, PANEL]); } },
      { say: 'Explore a generated board. Catan Lens scores every legal corner, and the gold ring marks the highest score still open.',
        act: async u => { await u.focus(BOARD); await u.at('the gold ring'); await u.hover('#svg .best-ring'); } },
      { say: 'The card beside the board says what that corner produces. Open "Why this corner?" for the reasoning in plain English: how much it yields, which resources, and whether they are rare on this board.',
        act: async u => { await u.focus('.best-card', { read: true }); await u.hover('.best-card h2'); await u.at('Why this corner'); await u.click('.best-card summary'); await u.at('plain English'); await u.focus('.best-card .why', { read: true }); } },
      { say: 'Curious about another spot? Click any corner for a grade, its share of the best score, and why another corner scores higher.',
        act: async u => { await u.click('.best-card summary'); await u.focus([BOARD, PANEL]); const r = u.ranking(); await u.at('Click any corner'); await u.click(corner(r[8].id)); await u.expect('.pick-card h2', '#9 of'); await u.at('a grade'); await u.focus('.pick-card', { read: true }); } },
      { say: 'Keep the best corner instead, and the ring moves to the second settlement that best completes your first.',
        act: async u => { await u.click('#cancel-pick'); await u.focus([BOARD, PANEL]); await u.click('#preview-best'); await u.click('#keep'); await u.expect(PANEL, 'Great pick'); await u.at('the ring moves'); await u.focus(BOARD); await u.hover('#svg .best-ring'); } },
      { say: 'Keep your second settlement to see resource income and the cards your first builds need. Income is an average; actual rolls vary.',
        act: async u => { await u.click('#preview-best'); await u.click('#keep'); await u.expect('.opening-card', 'Your opening'); await u.at('resource income'); await u.focus('.opening-resources', { read: true }); await u.at('first builds'); await u.focus('.opening-builds', { read: true }); } },
      { say: 'Practise with sixteen drill levels, or copy the real board from your table. It all runs in your browser, with no account and no tracking.',
        act: async u => { await u.focus('page'); await u.hover('#drill'); await u.at('copy the real board'); await u.hover('#custom'); } },
    ],
    title: 'Catan Lens: plan your opening',
  },
  {
    id: 'walkthrough',
    title: 'How Catan Lens works',
    url: '?seed=42&players=4&seat=1',
    intro: { title: 'How Catan Lens works', line: 'The scoring, your opening, Drill and Your board' },
    outro: { say: 'Catan Lens is free and open source. Try it in your browser, or build on it on GitHub.', title: 'Catan Lens', line: 'Try it free, or build on it' },
    scenes: [
      { chapter: 'How it scores', say: 'How does Catan Lens choose? It scores every legal corner with a handful of rules that strong players agree on, and production comes first.',
        act: async u => { await u.focus('page'); await u.at('It scores'); await u.focus(BOARD); await u.at('production comes first'); await u.hover('#svg .best-ring'); } },
      { say: 'Every number token carries dots. A six or an eight has five; a two or a twelve has just one. The dots count the ways two dice can roll that number, out of thirty-six.',
        act: async u => { await u.focus(['#svg .tok-n.red', TWO]); await u.at('A six or an eight'); await u.hover('#svg .tok-n.red'); await u.at('a two or a twelve'); await u.hover(TWO); } },
      { say: 'A corner collects from up to three hexes, so its production is the sum of their dots. Wheat and ore count a little extra, because they build cities and development cards.',
        act: async u => { await u.focus(BOARD); await u.hover('#svg .best-ring'); await u.at('Wheat and ore'); await u.focus('.best-card', { read: true }); await u.click('.best-card summary'); await u.focus('.best-card .why', { read: true }); } },
      { say: 'Resources that are rare on this board are worth more. Smaller bonuses reward wood with brick, wheat with ore, a harbour you can actually feed, and room to grow. Repeating a number costs a little.',
        act: async u => { await u.hover('.best-card .why'); await u.at('Repeating a number'); await u.click('.best-card summary'); } },
      { say: 'Every rule traces back to a published source: expert guides, champion interviews, and a statistical study of four hundred online games.',
        act: async u => { await u.click('[data-disclosure="method"] summary'); await u.focus('[data-disclosure="method"]', { read: true }); await u.at('expert guides'); await u.hover('[data-disclosure="method"] a'); } },
      { chapter: 'The draft', say: 'Placement is a snake draft. Projected placements plays it out for every seat, so you can see what is likely to be gone before your turn comes back. The suggested road steers away from corners other players will probably take first.',
        act: async u => { await u.click('[data-disclosure="method"] summary'); await u.focus([BOARD, PANEL]); await u.at('Projected placements'); await u.click('[data-disclosure="draft"] summary'); await u.at('The suggested road'); await u.focus(BOARD); } },
      { chapter: 'Your opening', say: 'Keep a first settlement, then choose your second. Your opening separates expected cards from how often you collect. Repeated numbers can pay several cards together, and the resource breakdown shows what you produce.',
        act: async u => { await u.click('[data-disclosure="draft"] summary'); await u.at('first settlement'); await u.click('#preview-best'); await u.click('#keep'); await u.at('choose your second'); await u.click('#preview-best'); await u.click('#keep'); await u.expect('.opening-card', 'Your opening'); await u.at('expected cards'); await u.focus('.opening-income'); await u.at('how often'); await u.focus('.opening-income + p', { read: true }); await u.at('resource breakdown'); await u.focus('.opening-resources', { read: true }); } },
      { say: 'The summary shows your starting hand and harbour trade rates. Open Plan your first builds to compare that hand with the cost of each purchase. Each row is a separate option, before new rolls or trades.',
        act: async u => { await u.focus(['.opening-facts > p:has-text("Starting hand")', '.opening-rates'], { read: true }); await u.at('Open Plan'); await u.click('.opening-builds > summary'); await u.focus('page'); await u.scrollTo('.opening-builds table'); await u.at('cost of each purchase'); await u.focus('.opening-builds table', { read: true }); } },
      { chapter: 'Drill mode', say: 'Drill mode turns this into practice. First, set the table: how many players, and whether to use Cities and Knights. That option changes resource weights; it does not simulate cities or commodities. Then climb sixteen levels with hints hidden until you commit.',
        act: async u => { await u.focus('page'); await u.scrollTo('page'); await u.click('.opening-builds > summary'); await u.click('#drill'); await u.at('set the table'); await u.click('#settings summary'); await u.at('how many players'); await u.hover('#players'); await u.at('Then climb'); await u.click('#settings summary'); await u.click('#start-drill'); await u.focus([BOARD, PANEL]); } },
      { say: 'Miss, and you see your rank, the score gap and what the level needed, then get a fresh board at the same level.',
        act: async u => { const r = u.ranking(); await u.click(corner(r[Math.min(12, r.length - 1)].id)); await u.click('#keep'); await u.expect('.card.drill .grade', 'Not this time'); await u.at('your rank'); await u.focus('.card.drill', { read: true }); } },
      { say: 'Find the best corner, and the level is cleared. Later levels demand the exact best score on near ties. A closely scored choice can still be sensible in a real game.',
        act: async u => { await u.click('#scramble'); await u.focus([BOARD, PANEL]); const r = u.ranking(); await u.click(corner(r[0].id)); await u.click('#keep'); await u.expect('.card.drill .grade', 'Level cleared'); await u.at('the level is cleared'); await u.focus('.card.drill'); await u.at('Later levels'); await u.hover('.track'); } },
      { chapter: 'Your board', say: 'Playing at a real table? Enter the board in front of you. Pick a resource and tap hexes to paint them, choose Numbers to set the tokens, and tap the coast to place harbours.',
        act: async u => { await u.focus('page'); await u.click('#drill'); await u.click('#reset'); await u.click('#custom'); await u.focus([BOARD, PANEL]); await u.at('Pick a resource'); await u.click('#tool-ore'); await u.click('#svg .hex >> nth=4'); await u.at('choose Numbers'); await u.click('#tool-number'); await u.click('#svg .hex >> nth=4'); await u.click('.picker button[data-num="6"]'); await u.at('tap the coast'); await u.click('#tool-port'); await u.click('#svg .coast-hit:not(.empty)'); await u.click('#tool-port'); } },
      { say: 'Advice waits until the tiles are complete and the harbours are checked. Finish or confirm the harbours you entered, or choose Ignore harbour effects to leave ports out of the analysis. Copy link shares your board and that choice.',
        act: async u => { await u.focus('.harbor-analysis', { read: true }); await u.at('Ignore harbour effects'); await u.click('#port-mode'); await u.focus(BOARD); await u.hover('#svg .best-ring'); await u.at('Copy link'); await u.focus('page'); await u.hover('#share'); } },
      { chapter: 'Does it win?', say: 'Forty thousand fresh bot games found Lens ahead of simply taking the most dots, with no clear advantage over the bot\'s own opening choices. These four-player results do not predict your personal win rate.',
        act: async u => { await u.showResults(); } },
    ],
  },
];

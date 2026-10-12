// The benchmark bridge answers with the same choices the app makes: the classic ranking for "lens" and the
// look-ahead ranking for "lens-draft", given pieces in placement order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateBoard } from '../public/board.js';
import { rankSpots, simulateDraft } from '../public/score.js';
import { rankLookahead } from '../public/lookahead.js';

const bridge = fileURLToPath(new URL('../bench/lens-bridge.mjs', import.meta.url));
const ask = requests => spawnSync(process.execPath, [bridge], { input: requests.map(r => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8' })
  .stdout.trim().split('\n').map(line => JSON.parse(line));

test('lens and lens-draft settle requests match the app rankings, with the projection for lens-draft', () => {
  const b = generateBoard({ seed: 3 });
  const board = { hexes: b.hexes.map(h => ({ resource: h.resource, number: h.number })), harbors: b.harbors };
  const s = { players: 4, seat: 4, cak: false };
  const opp = simulateDraft(b, s).filter(d => d.round === 1 && d.seat < 4).map(d => d.id);
  const [classic, draft] = ask([
    { op: 'settle', board, seat: 4, players: 4, mine: [], occupied: opp, policy: 'lens' },
    { op: 'settle', board, seat: 4, players: 4, me: [], opp, policy: 'lens-draft' },
  ]);
  assert.equal(classic.vertex, rankSpots(b, s, { mine: [], occupied: opp })[0].id);
  const top = rankLookahead(b, s, { me: [], opp })[0];
  assert.equal(draft.vertex, top.id);
  assert.notEqual(draft.vertex, classic.vertex, 'seed 3, last seat: the two policies disagree');
  assert.deepEqual(draft.projection.map(d => d.id), top.projection.map(d => d.id));
  assert.deepEqual(draft.projection.filter(d => d.seat === 4).map(d => d.id), [top.id, top.second.id]);
});

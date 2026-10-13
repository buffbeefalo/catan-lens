// Starting roads (R13): placing, moving and undoing your own road, link replay, settlement-time grading and what
// blind practice may show. Run with node --test (npm run e2e runs it after the usability suite).
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { chromium, firefox, webkit } = require('playwright');

const { BASE: base, showDraft } = require('./helpers.cjs');
let browser;
before(async () => {
  const name = process.env.CATAN_BROWSER || 'chromium';
  const engine = { chromium, firefox, webkit }[name];
  if (!engine) throw new Error('Unknown CATAN_BROWSER: ' + name);
  browser = await engine.launch({ headless: true, executablePath: name === 'chromium' ? process.env.CHROMIUM_PATH || undefined : undefined });
});
after(async () => { await browser?.close(); });

async function open(t, viewport, query = '?seed=42&players=4&seat=1') {
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await page.goto(base + query, { waitUntil: 'networkidle' });
  return page;
}

async function reloadInBrowser(page) {
  await Promise.all([page.waitForEvent('domcontentloaded'), page.evaluate(() => location.reload())]);
}

// Everything a reader or a screen reader can get from the road cards, and from the road controls on the board:
// visible text, labels, descriptions and titles.
const surface = (page, selector) => page.evaluate(sel => [...document.querySelectorAll(sel)]
  .map(el => [el.innerText ?? el.textContent, ...['aria-label', 'aria-description', 'title'].map(a => el.getAttribute(a)), el.querySelector('title')?.textContent].filter(Boolean).join(' ')).join(' | '), selector);
const roadCards = page => surface(page, '.road-grade, .road-grade *, .road-prompt');
const roadControls = page => surface(page, '#svg .road-hit, #svg .road-slot, #svg .my-road, #svg .my-road-edge, #svg .road');
// The board edges that drawn suggestion lines lie on: cls 'me' for kept settlements, 'pick' for a preview.
async function drawnEdges(page, board, cls) {
  const key = c => c.map(n => Number(n).toFixed(3)).join(',');
  const byKey = new Map(board.graph.edges.map((e, i) => [key(e.v.flatMap(j => [board.graph.vertices[j].x, board.graph.vertices[j].y])), i]));
  return (await page.locator(`#svg .road.${cls}`).evaluateAll(ls => ls.map(l => ['x1', 'y1', 'x2', 'y2'].map(a => l.getAttribute(a)))))
    .map(c => byKey.get(key(c))).sort((a, b) => a - b);
}
const BLIND_DETAIL = /corner|pip|port|projected|%|points|direction|open|wheat|wood|brick|sheep|ore/i;   // nothing a road card may say with hints off
const CONTROL_HINT = /Great|Fair|Weak|best|better|pip|port|projected|wheat|wood|brick|sheep|ore/i;      // controls name positions only

const ROAD_GRADE = /Your road: (Great|Fair|Weak) road/;
const roadGrade = page => page.locator('.road-grade .grade').first().innerText();
const seqOf = page => new URL(page.url()).searchParams.get('seq');

test('a starting road you place is graded, moves, undoes and survives a reload', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('#preview-best').click(); await page.locator('#keep').click();
  assert.equal(await page.locator('#svg .road-slot').count(), 3, 'every free side of the kept settlement is offered');
  assert.match(await page.locator('.verdict .road-prompt').innerText(), /click or tap a side of this settlement/);
  const { suggestRoad } = await import('../public/score.js'); const { generateBoard } = await import('../public/board.js');
  const board = generateBoard({ seed: 42 }), token = e => `r43-${board.graph.edges[e].v.find(x => x !== 43)}`;   // a road in the link: settlement, then far corner
  const suggested = suggestRoad(board, { players: 4, seat: 1, cak: false }, 43).edge;
  const sides = (await page.locator('#svg .road-hit').evaluateAll(a => a.map(x => Number(x.dataset.edge)))).filter(e => e !== suggested);
  // a mouse click on the side itself (the board's own hit test), away from the suggested direction
  await page.locator(`#svg .road-hit[data-edge="${sides[0]}"]`).scrollIntoViewIfNeeded();   // Keep scrolled the verdict into view
  const box = await page.locator(`#svg .road-hit[data-edge="${sides[0]}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const first = await roadGrade(page);
  assert.match(first, ROAD_GRADE); assert.doesNotMatch(first, /Great road/);
  assert.match(await page.locator('.road-grade').innerText(), /Judged as of this settlement’s turn; later placements do not change it\./);
  assert.equal(seqOf(page), `m43,${token(sides[0])}`);
  assert.equal(await page.locator('.pick-card').count(), 0, 'a tap on a side never previews a settlement');
  assert.equal(await page.locator('#svg .my-road').count(), 1);
  assert.equal(await page.locator('#svg .road.me.hinted').count(), 1, 'the suggestion is drawn dashed beside a different road');
  assert.equal(await page.locator('#svg .road-slot').count(), 0, 'slots give way once the settlement has its road');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'road-grade-43');
  // a click on a corner still previews a settlement and never lays a road (the grade scrolled into view, so bring the
  // ring back on screen first)
  await page.locator('#svg .best-ring').scrollIntoViewIfNeeded();
  const corner = await page.locator('#svg .best-ring').boundingBox();
  await page.mouse.click(corner.x + corner.width / 2, corner.y + corner.height / 2);
  assert.equal(await page.locator('.pick-card').count(), 1);
  assert.equal(seqOf(page), `m43,${token(sides[0])}`);
  await page.locator('#cancel-pick').click();
  await page.locator(`#svg .road-hit[data-edge="${suggested}"]`).press('Enter');
  assert.match(await roadGrade(page), /Your road: Great road\. The best direction/);
  assert.equal(await page.locator(`#svg .road-hit[data-edge="${suggested}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#svg .road.me').count(), 0, 'on the suggested side your road shows alone');
  assert.equal(seqOf(page), `m43,${token(sides[0])},${token(suggested)}`);
  await page.locator('#undo').click();
  assert.equal(await roadGrade(page), first, 'Undo moves the road back');
  assert.equal(seqOf(page), `m43,${token(sides[0])}`);
  await reloadInBrowser(page); await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  assert.equal(await roadGrade(page), first);
  await page.locator('#undo').click();
  assert.equal(await page.locator('.road-grade, #svg .my-road').count(), 0);
  assert.equal(await page.locator('#svg .road-slot').count(), 3);
});

test('Undo takes back a road without touching an opponent mark that shares its number', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=3&opp=16&seq=m3,o16');   // side 16 of corner 3; corner 16 holds a mark
  await page.locator('#svg .road-hit[data-edge="16"]').press('Enter');
  assert.match(seqOf(page), /^m3,o16,r3-\d+$/);
  await page.locator('#undo').click();
  assert.equal(seqOf(page), 'm3,o16');
  assert.equal(await page.locator('#svg .piece.opp').count(), 1);
  assert.equal(await page.locator('#svg .my-road').count(), 0);
});

test('a road entered late is still graded as of its settlement’s turn', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43&seq=m43');
  await page.locator('#svg .road-hit[data-edge="61"]').press('Enter');
  const onTime = await roadGrade(page);
  const late = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43&opp=45&seq=m43,o45');
  await late.locator('#svg .road-hit[data-edge="61"]').press('Enter');
  assert.equal(await roadGrade(late), onTime, 'an opponent marked after the settlement does not change its road verdict');
});

test('blind practice holds a placed road’s grade until both settlements are down, then shows only the grade', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&seat=1&best=0');
  await page.locator('#svg .vx.legal[aria-label="Corner 43"]').press('Enter'); await page.locator('#keep').click();
  assert.equal(await page.locator('#svg .road, .verdict .road').count(), 0);
  await page.locator('#svg .road-hit').first().scrollIntoViewIfNeeded();   // on a phone, Keep scrolls the verdict to the top
  const box = await page.locator('#svg .road-hit').first().boundingBox();   // a vertical side has no width, so tap its middle
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await page.locator('#svg .my-road').count(), 1);
  const text = await page.locator('.road-grade').innerText();
  assert.match(text, /Your starting road is placed\. Its grade appears once both settlements are down; turn on Show best to see how it compares now\./);
  assert.doesNotMatch(text, /Great|Fair|Weak|corner|projected/);
  const leaks = async () => {
    assert.doesNotMatch(await roadControls(page), CONTROL_HINT);
    assert.doesNotMatch(await roadCards(page), BLIND_DETAIL);
    assert.equal(await page.locator('#svg .road').count(), 0, 'the suggested road stays hidden');
  };
  assert.equal(await page.locator('.road-grade.great, .road-grade.fair, .road-grade.weak').count(), 0, 'no grade colour before the second settlement');
  await leaks();
  // with both settlements down there is no future pick left to give away: the bare grade appears, nothing more
  await page.locator('#svg .vx.legal').first().press('Enter'); await page.locator('#keep').click();
  const graded = await page.locator('.road-grade').first().innerText();
  assert.match(graded, /^Your road: (Great|Fair|Weak) road\n+Turn on Show best to see why\./);
  assert.doesNotMatch(graded, /corner|pip|port|projected|%|points|direction|open/);
  assert.equal(await page.locator('.road-grade.great, .road-grade.fair, .road-grade.weak').count(), 0, 'the bare grade is neutrally styled');
  await leaks();
  await reloadInBrowser(page); await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  assert.equal(await page.locator('.road-grade').first().innerText(), graded, 'a reload applies the same rule');
  await page.locator('#undo').click();   // the second settlement comes off the board, so the grade is held again
  assert.match(await page.locator('.road-grade').first().innerText(), /^Your starting road is placed\. Its grade appears once both settlements are down/);
  assert.equal(await page.locator('.road-grade.great, .road-grade.fair, .road-grade.weak').count(), 0);
  await page.locator('#showbest').click();
  assert.match(await roadGrade(page), ROAD_GRADE);
  assert.match(await page.locator('.road-grade').first().innerText(), /Your road: \w+ road\. .*\n+.*\d+-pip corner/, 'with hints on, the card says why and names the corner that way');
  await page.locator('#svg .vx.legal').first().press('Enter'); await page.locator('#keep').click();
  await page.locator('#showbest').click();   // hints off again after viewing them: back to the bare grade, nothing more
  assert.match(await page.locator('.road-grade').first().innerText(), /^Your road: (Great|Fair|Weak) road\n+Turn on Show best to see why\./);
  assert.equal(await page.locator('.road-grade.great, .road-grade.fair, .road-grade.weak').count(), 0);
  await leaks();
});

test('a kept settlement’s suggested road is the one its road grade calls best, however much is placed later', async t => {
  // Demo board: keep corner 43, then the best second corner (3). Judged on the board as it is after both,
  // the first settlement's road would point another way; its own turn says side 57, and that is what is drawn.
  const { suggestRoad } = await import('../public/score.js'); const { generateBoard } = await import('../public/board.js');
  const board = generateBoard({ seed: 42 }), S = { players: 4, seat: 1, cak: false };
  const turn = suggestRoad(board, S, 43, {}), later = suggestRoad(board, S, 43, { mine: [43, 3], occupied: [43, 3] });
  assert.notEqual(later.edge, turn.edge, 'the scenario needs the two positions to disagree');
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43,3&seq=m43,m3');
  for (const when of ['loaded', 'reloaded']) {
    if (when === 'reloaded') await reloadInBrowser(page);
    assert.ok((await page.locator('.verdict:has(#verdict-1)').innerText()).includes(turn.text), `${when}: the card explains the road of its own turn`);
    assert.ok((await drawnEdges(page, board, 'me')).includes(turn.edge), `${when}: the map draws it along side ${turn.edge}`);
    assert.ok(!(await drawnEdges(page, board, 'me')).includes(later.edge), `${when}: not along side ${later.edge}`);
  }
  await page.locator(`#svg .road-hit[data-edge="${turn.edge}"]`).press('Enter');
  assert.match(await roadGrade(page), /Your road: Great road/);
  assert.equal(await page.locator('#svg .road.me.hinted').count(), 0, 'no other side is drawn as the better road');
  await page.locator(`#svg .road-hit[data-edge="${later.edge}"]`).press('Enter');
  assert.match(await roadGrade(page), /Your road: Weak road/);
  assert.deepEqual(await page.locator('#svg .road.me.hinted').evaluateAll(ls => ls.length), 1, 'a Weak road is shown the better side, dashed');
  assert.ok((await drawnEdges(page, board, 'me')).includes(turn.edge));
  assert.ok((await page.locator('.verdict:has(#verdict-1)').innerText()).includes(turn.text), 'and the card explains it');
  await page.locator('#showbest').click();
  assert.equal(await page.locator('#svg .road').count(), 0, 'with hints off no side is drawn as better');
});

test('road placement stays out of opponent marking, open previews and Drill', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43&seq=m43');
  assert.equal(await page.locator('#svg .road-hit').count(), 3);
  await page.locator('#mode-opp').click();
  assert.equal(await page.locator('#svg .road-hit, #svg .road-slot, .road-prompt').count(), 0);
  await page.locator('#mode-me').click();
  await page.locator('#svg .vx.legal').first().press('Enter');
  assert.equal(await page.locator('#svg .road-hit, #svg .road-slot').count(), 0, 'a pending settlement preview comes first');
  await page.locator('#cancel-pick').click();
  await page.locator('#drill').click(); await page.locator('#start-drill').click();
  const { setupStage, stageFor } = await import('../public/drill.js'); const q = new URL(page.url()).searchParams;
  const r = setupStage(stageFor(Number(q.get('level')), { players: 4, cak: false }), Number(q.get('seed'))).ranking[0].id;
  await page.locator(`#svg .vx.legal[aria-label="Corner ${r}"]`).press('Enter'); await page.locator('#keep').click();
  assert.equal(await page.locator('#svg .road-hit, #svg .road-slot, .road-prompt, .road-grade').count(), 0);
});

test('a road tied for the best direction is not shown a better side', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=29&players=3&seat=3&me=8&seq=m8');   // sides 8 and 14 tie; the suggestion is drawn along 8
  assert.equal(await page.locator('#svg .road.me').count(), 1);
  assert.equal(await page.locator('.verdict .road').count(), 1, 'before a road, the card explains the suggestion');
  await page.locator('#svg .road-hit[data-edge="14"]').press('Enter');
  assert.match(await roadGrade(page), /Your road: Great road/);
  assert.equal(await page.locator('#svg .road.me').count(), 0, 'no dashed alternative beside a tied best road');
  assert.equal(await page.locator('.verdict .road').count(), 0, 'nor a suggestion pointing the other way in the card');
  await page.locator('#svg .road-hit[data-edge="8"]').press('Enter');
  assert.equal(await page.locator('.verdict .road').count(), 1, 'on the suggested side the card explains it as before');
});

test('road tokens that do not fit the board are dropped from a shared link', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43&seq=r43-46,m43,r43-43,r43-999,r0-1,r43-33,r43-46,r43-46,r61');
  assert.equal(seqOf(page), 'm43,r43-46', 'a road before its settlement, from a settlement to itself, off the board, away from your settlements, not along a side, repeated or malformed is dropped');
  assert.ok(!Number.isInteger(Number('r43-46'.slice(1))), 'an app without roads reads no corner number from the token, so it drops it');
  assert.equal(await page.locator('#svg .my-road').count(), 1);
  assert.match(await roadGrade(page), ROAD_GRADE);
});



test('roads are optional and never change the settlements, their order or the projected draft', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('#preview-best').click(); await page.locator('#keep').click();
  await page.locator('#preview-best').click(); await page.locator('#keep').click();   // the second settlement is kept with no road for the first
  assert.equal(await page.locator('#svg .piece.me').count(), 2);
  assert.equal(await page.locator('.verdict .road-prompt').count(), 2, 'both settlements still invite a road');
  const seq = new URL(page.url()).searchParams.get('seq');
  await showDraft(page);
  const draft = await page.locator('[data-disclosure="draft"]').innerText();
  for (const hit of await page.locator('#svg .road-hit').all()) { if (await hit.isVisible()) { await hit.press('Enter'); break; } }
  const second = page.locator('#svg .road-hit[aria-label*="second settlement"]').first();
  await second.press('Enter');
  assert.equal(await page.locator('#svg .my-road').count(), 2, 'one road for each settlement');
  assert.equal(await page.locator('#svg .piece.me').count(), 2, 'a road never adds a settlement');
  assert.match(seqOf(page), new RegExp(`^${seq},r\\d+-\\d+,r\\d+-\\d+$`), 'roads follow the settlements without reordering them');
  assert.equal(await page.locator('[data-disclosure="draft"]').innerText(), draft, 'the projected draft ignores roads');
  // the same side again is a no-op
  const before = seqOf(page);
  await second.press('Enter');
  assert.equal(seqOf(page), before);
});

test('a road placed late, or moved later, is still judged on its settlement’s own turn', async t => {
  // Demo board after keeping corner 43 and then corner 3. On the board as it stands, side 56 of corner 43 would be
  // the best direction and side 57 only Fair; on 43's own turn it was the other way round.
  const { gradeRoad } = await import('../public/score.js'); const { generateBoard } = await import('../public/board.js');
  const board = generateBoard({ seed: 42 }), S = { players: 4, seat: 1, cak: false }, live = { mine: [43, 3], occupied: [43, 3] };
  assert.deepEqual([gradeRoad(board, S, 43, 56, live).tier, gradeRoad(board, S, 43, 56, {}).tier], ['great', 'weak'], 'the two positions disagree');
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43,3&seq=m43,m3');
  await page.locator('#svg .road-hit[data-edge="56"]').press('Enter');
  assert.match(await roadGrade(page), /Your road: Weak road/);
  await page.locator('#svg .road-hit[data-edge="57"]').press('Enter');
  assert.match(await roadGrade(page), /Your road: Great road/);
  await page.locator('#mode-opp').click(); await page.locator('#svg .vx.legal').first().press('Enter'); await page.locator('#mode-me').click();
  await page.locator('#svg .road-hit[data-edge="56"]').press('Enter');   // moved after a later opponent mark
  assert.match(await roadGrade(page), /Your road: Weak road/);
});

test('a link from before roads loads exactly as it did, and the latest valid road for a settlement wins', async t => {
  const legacy = '?seed=42&players=4&seat=1&me=43,3&opp=16&seq=m43,o16,m3';
  const page = await open(t, { width: 1400, height: 900 }, legacy);
  assert.equal(seqOf(page), 'm43,o16,m3');
  assert.equal(await page.locator('#svg .piece.me').count(), 2);
  assert.equal(await page.locator('#svg .piece.opp').count(), 1);
  assert.equal(await page.locator('#svg .my-road').count(), 0);
  assert.equal(await page.locator('.verdict').count(), 2);
  const latest = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43&seq=m43,r43-46,x12,r43-,m,o,r-43-46,r43-44');
  assert.equal(seqOf(latest), 'm43,r43-46,r43-44', 'unknown and malformed tokens are dropped; both valid roads stay in the history');
  assert.equal(await latest.locator('#svg .road-hit[aria-pressed="true"]').getAttribute('data-edge'), '57', 'the road ends at corner 44, along side 57');
  await latest.locator('#undo').click();
  assert.equal(await latest.locator('#svg .road-hit[aria-pressed="true"]').getAttribute('data-edge'), '61', 'Undo returns it to corner 46, along side 61');
});

test('a settlement with no two-road target gets no grade, with hints on or off', async t => {
  const query = '?players=4&seed=4&seat=4&me=8,32&opp=2,44,42,33,18,30&seq=o2,o44,o42,m8,o33,o18,o30,m32';
  const page = await open(t, { width: 1400, height: 900 }, query);
  await page.locator('#svg .road-hit[aria-label*="second settlement"]').first().press('Enter');
  const card = page.locator('.verdict:has(#verdict-2) .road-grade');
  assert.match(await card.innerText(), /^Your road: No two-road target\. No direction from this settlement has an open settlement site two roads away\. Longer routes are not checked\./);
  assert.equal(await page.locator('.road-grade.great, .road-grade.fair, .road-grade.weak').count(), 0);
  await page.locator('#showbest').click();
  assert.match(await page.locator('.verdict:has(#verdict-2) .road-grade').innerText(), /^Your road: No two-road target\n+Turn on Show best to see why\.\n+Click or tap another side of the settlement to move it\.$/);
});

test('in Your board, a kept settlement takes and grades a road the same way', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const { b } = encodeBoard(generateBoard({ seed: 42 }));
  const page = await open(t, { width: 1400, height: 900 }, `?players=4&seat=1&b=${b}&ports=ignore&me=43&seq=m43`);
  assert.equal(await page.locator('#svg .road-slot').count(), 3);
  await page.locator('#svg .road-hit').first().press('Enter');
  assert.match(await roadGrade(page), ROAD_GRADE);
  assert.match(seqOf(page), /^m43,r43-\d+$/);
});

test('previewing a corner and keeping it draws the same road, and later marks or Undo do not move it', async t => {
  const { generateBoard } = await import('../public/board.js'); const board = generateBoard({ seed: 42 });
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('#preview-best').click();
  const preview = await drawnEdges(page, board, 'pick'), previewText = (await page.locator('.pick-card .road').textContent()).trim();   // inside the collapsed reasons
  assert.equal(preview.length, 1); assert.match(previewText, /^Road: point it toward/);
  await page.locator('#keep').click();
  const kept = async () => [await drawnEdges(page, board, 'me'), (await page.locator('.verdict:has(#verdict-1) .road').textContent()).trim()];
  assert.deepEqual(await kept(), [preview, previewText], 'Keep leaves the previewed road where it was');
  await page.locator('#mode-opp').click(); await page.locator('#svg .vx.legal').first().press('Enter');
  assert.deepEqual(await kept(), [preview, previewText], 'a later opponent mark does not move it');
  await page.locator('#undo').click();
  assert.deepEqual(await kept(), [preview, previewText], 'nor does undoing that mark');
});

test('in the original order of the search-limit fixture, the second settlement keeps the road of its own turn', async t => {
  // Blockers marked after settlement 32 do not change the road it was given when it went down (contrast with
  // 'an unavailable two-road hint explains its search limit', where they come first).
  const { suggestRoad } = await import('../public/score.js'); const { generateBoard } = await import('../public/board.js');
  const turn = suggestRoad(generateBoard({ seed: 4 }), { players: 4, seat: 4, cak: false }, 32, { mine: [8], occupied: [2, 44, 42, 8] });
  const page = await open(t, { width: 390, height: 844 }, '?players=4&seed=4&seat=4&me=8,32&opp=2,44,42,33,18,30&seq=o2,o44,o42,m8,m32,o33,o18,o30');
  const text = await page.locator('.verdict:has(#verdict-2) .road').innerText();
  assert.equal(text, turn.text);
  assert.doesNotMatch(text, /No legal settlement site is open two roads away/);
});

test('a link without a placement order lists opponents first, and roads are advised from that order', async t => {
  const { suggestRoad, gradeRoad } = await import('../public/score.js'); const { generateBoard } = await import('../public/board.js');
  // Rebuilt as o16, m43, m3: corner 43's road comes from "16 down, nothing of yours"; the board as it ends up
  // (3 kept too) would point it along another side and grade that side Great.
  const board = generateBoard({ seed: 42 }), S = { players: 4, seat: 1, cak: false }, position = { mine: [], occupied: [16] };
  const road = suggestRoad(board, S, 43, position), second = suggestRoad(board, S, 3, { mine: [43], occupied: [16, 43] });
  assert.notEqual(suggestRoad(board, S, 43, { mine: [43, 3], occupied: [43, 3, 16] }).edge, road.edge, 'the scenario needs the two positions to disagree');
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43,3&opp=16');
  assert.equal(seqOf(page), 'o16,m43,m3');
  assert.deepEqual(await drawnEdges(page, board, 'me'), [road.edge, second.edge].sort((a, b) => a - b));
  assert.ok((await page.locator('.verdict:has(#verdict-1) .road').innerText()).includes(road.text));
  // a road on another side is graded from that same order, and a reload or the re-shared link shows the same
  const side = board.graph.vertices[43].edges.find(e => e !== road.edge && ['fair', 'weak'].includes(gradeRoad(board, S, 43, e, position)?.tier));
  await page.locator(`#svg .road-hit[data-edge="${side}"]`).press('Enter');
  const shown = async p => [await roadGrade(p), (await p.locator('.verdict:has(#verdict-1) .road').innerText()).trim(), await drawnEdges(p, board, 'me')];
  const why = gradeRoad(board, S, 43, side, position).why;
  const expected = [`Your road: ${gradeRoad(board, S, 43, side, position).label}. ${why[0].toUpperCase() + why.slice(1)}`, road.text, [road.edge, second.edge].sort((a, b) => a - b)];
  assert.deepEqual(await shown(page), expected);
  await reloadInBrowser(page); await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  assert.deepEqual(await shown(page), expected, 'after a reload');
  assert.match(seqOf(page), /^o16,m43,m3,r43-\d+$/);
  const shared = await open(t, { width: 1400, height: 900 }, new URL(page.url()).search);
  assert.deepEqual(await shown(shared), expected, 'from the re-shared link');
});

test('Drill keeps drawing a placed settlement’s road from the board as it is now, as before roads', async t => {
  // Level 10 (your second settlement), seed 11, four players: Drill places your first settlement on corner 9. Once
  // you keep the best corner, the board as it is points 9's road one way; the position Drill rebuilt for it (all
  // opponents first) would point it another. Drill has no road placement, so it keeps the board as it is.
  const { setupStage, stageFor } = await import('../public/drill.js'); const { suggestRoad } = await import('../public/score.js');
  const r = setupStage(stageFor(10, { players: 4, cak: false }), 11), [first, pick] = [r.me[0], r.ranking[0].id];
  const now = suggestRoad(r.board, r.settings, first, { mine: [first, pick], occupied: [first, pick, ...r.opp] });
  const rebuilt = suggestRoad(r.board, r.settings, first, { mine: [], occupied: [...r.opp] });
  assert.notEqual(now.edge, rebuilt.edge, 'the scenario needs the two positions to disagree');
  const page = await open(t, { width: 1400, height: 900 });
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': Array.from({ length: 16 }, (_, i) => i + 1) } })));
  await page.goto(base + '?drill=1&level=10&seed=11&players=4', { waitUntil: 'networkidle' });
  await page.locator(`#svg .vx.legal[aria-label="Corner ${pick}"]`).press('Enter'); await page.locator('#keep').click();
  const drawn = await drawnEdges(page, r.board, 'me');
  assert.ok(drawn.includes(now.edge), `side ${now.edge} is drawn`);
  assert.ok(!drawn.includes(rebuilt.edge), `side ${rebuilt.edge} is not`);
  // the corner you kept is explained as the published app explained it: the original scorer on the board as it is
  const { suggestRoad: published } = await import('../test/fixtures/score-before-starting-roads.mjs');
  const yours = published(r.board, r.settings, pick, { mine: [first, pick], occupied: [first, pick, ...r.opp] });
  assert.equal((await page.locator('.card.drill .road, .verdict .road').first().textContent()).trim(), yours.text);
  assert.deepEqual(drawn, [now.edge, yours.edge].sort((a, b) => a - b), 'both kept settlements are drawn as before roads');
});

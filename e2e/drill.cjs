const { showSettings, showDraft, BASE } = require('./helpers.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const { stageFor, setupStage } = await import(require('url').pathToFileURL(require('path').join(__dirname, '../public/drill.js')).href);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const q = () => Object.fromEntries(new URL(page.url()).searchParams);
  const text = () => page.$eval('#panel', el => el.innerText);
  const counts = () => page.evaluate(() => ({ badges: document.querySelectorAll('#svg .badge').length, opp: document.querySelectorAll('#svg .piece.opp').length, me: document.querySelectorAll('#svg .piece.me').length }));
  const clickCorner = id => page.$eval(`#svg .vx[aria-label="Corner ${id}"]`, c => c.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const facing = () => { const p = q(); return setupStage(stageFor(+p.level, { players: +p.players, cak: p.cak === '1' }), +p.seed).ranking; };
  const disabled = sel => page.$eval(sel, b => b.disabled);

  await page.goto(BASE + '?seed=42&players=4&seat=1', { waitUntil: 'networkidle' });
  await page.click('#drill');
  // setup step: no level yet, Players + C&K live, everything else locked, no hints, no placing
  let p = q(); assert.equal(p.drill, undefined); assert.equal(p.level, undefined);
  let t = await text(); assert.match(t, /set your table first[\s\S]*4 players, base game[\s\S]*fresh ladder, you start at level 1/); assert.doesNotMatch(t, /Level 1 of|Best first settlement|Projected placements|Mark opponent/);
  assert.ok(!(await disabled('#players button'))); assert.ok(!(await disabled('#cak'))); assert.ok(await disabled('#seat button')); assert.ok(await disabled('#showbest')); assert.ok(await disabled('#seed'));
  assert.deepEqual(await counts(), { badges: 0, opp: 0, me: 0 });
  await clickCorner(5); assert.doesNotMatch(await text(), /Your pick/);
  console.log('drill on → setup card: table controls live, rest locked, corners inert');
  // change the table in the bar: the card follows
  await showSettings(page); await page.click('#players button:nth-child(4)'); await showSettings(page); await page.click('#cak');
  t = await text(); assert.match(t, /6 players, Cities & Knights/); assert.equal(q().players, '6'); assert.equal(q().cak, '1');
  await showSettings(page); await page.click('#players button:nth-child(2)'); await showSettings(page); await page.click('#cak');
  assert.match(await text(), /4 players, base game/);
  await page.click('#start-drill');
  p = q(); assert.equal(p.drill, '1'); assert.equal(p.level, '1'); assert.equal(p.players, '4'); assert.equal(p.cak, '0');
  t = await text(); assert.match(t, /Level 1 of 16[\s\S]*Clear favourite[\s\S]*4 players · you are seat 1[\s\S]*top 3 corners/); assert.doesNotMatch(t, /Best first settlement|Projected placements|Mark opponent|set your table/);
  assert.deepEqual(await counts(), { badges: 0, opp: 0, me: 0 });
  assert.ok(await disabled('#players button')); assert.ok(await disabled('#cak')); assert.ok(await disabled('#showbest'));
  console.log('Start → level 1 on the chosen table, controls now locked, hints hidden');
  // clear level 1 with the true best corner
  let r = facing(); await clickCorner(r[0].id);
  t = await text(); assert.match(t, /Your pick\s+preview/); assert.doesNotMatch(t, /% of best|pips of production|Score \d/); assert.match(t, /appear once you commit/);
  await page.click('#keep');
  t = await text(); assert.match(t, /Level cleared[\s\S]*You found the best corner/);
  assert.equal((await counts()).badges, 0, 'an answer leaves projections closed until requested');
  await showDraft(page); await page.click('#panel .rank.draft li:nth-child(3)');   // projected rows are inert once answered
  assert.doesNotMatch(await text(), /Your pick/); assert.match(t, /Your first settlement[\s\S]*Great pick/); assert.match(t, /Projected placements/);
  assert.equal((await counts()).badges, 8, 'opening projections after commit reveals the full draft');
  await page.click('#next-stage');
  p = q(); assert.equal(p.level, '2'); assert.equal(p.players, '4');
  t = await text(); assert.match(t, /Level 2 of 16[\s\S]*Still clear/); assert.equal((await counts()).badges, 0);
  console.log('level 1 cleared → level 2, hints hidden again');
  // fail level 2 on purpose: worst corner
  r = facing(); const seedBefore = p.seed; await clickCorner(r[r.length - 1].id); await page.click('#keep');
  t = await text(); assert.match(t, /Not this time[\s\S]*top 3 corners/); assert.match(t, /Attempt 1/);
  assert.equal((await counts()).badges, 8, 'remembered projections return only after answering');
  await page.locator('[data-disclosure="draft"] > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('#svg .badge').length === 0);
  await page.click('#scramble');
  p = q(); assert.equal(p.level, '2'); assert.notEqual(p.seed, seedBefore); assert.equal((await counts()).badges, 0);
  t = await text(); assert.match(t, /Attempt 2/); assert.doesNotMatch(t, /Not this time/);
  console.log('wrong pick → scrambled board, same level, attempt 2');
  // one placement per level: after committing, clicking another corner does nothing
  r = facing(); await clickCorner(r[0].id); await page.click('#keep');
  const meBefore = (await counts()).me; await clickCorner(r[5].id);
  assert.equal((await counts()).me, meBefore); assert.doesNotMatch(await text(), /Your pick/);
  console.log('after commit further clicks ignored');
  // level 4 (second to pick) pre-places one opponent; level 10 (second settlement, last seat) pre-places your first + 3 opponents
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': Array.from({ length: 16 }, (_, i) => i + 1), '6-cak': Array.from({ length: 16 }, (_, i) => i + 1), '3-base': Array.from({ length: 16 }, (_, i) => i + 1) } })));   // unlock everything for the direct-link checks
  await page.goto(BASE + '?drill=1&level=4&seed=7&players=4', { waitUntil: 'networkidle' });
  assert.deepEqual(await counts(), { badges: 0, opp: 1, me: 0 }); assert.match(await text(), /1 opponent has already placed/);
  await page.goto(BASE + '?drill=1&level=10&seed=7&players=4', { waitUntil: 'networkidle' });
  assert.deepEqual(await counts(), { badges: 0, opp: 3, me: 1 }); assert.match(await text(), /Place your second settlement/);
  r = facing(); await clickCorner(r[0].id); await page.click('#keep');
  t = await text(); assert.match(t, /Level cleared/); assert.match(t, /Your second settlement[\s\S]*Great pick/); assert.doesNotMatch(t, /Your first settlement/); assert.match(t, /Your opening/);
  console.log('level 4/10 pre-placements right; second-settlement verdict only for the piece you placed');
  // the same level on other tables: seats resolve to the table, C&K comes from the link, 6-player board is the big one
  await page.goto(BASE + '?drill=1&level=10&seed=7&players=6&cak=1', { waitUntil: 'networkidle' });
  t = await text(); assert.match(t, /6 players · you are seat 6 · Cities & Knights weighting/); assert.match(t, /6 players, Cities & Knights/);
  assert.deepEqual(await counts(), { badges: 0, opp: 5, me: 1 }); assert.equal(await page.$eval('#cak', b => b.getAttribute('aria-pressed')), 'true');
  const hexes6 = await page.$$eval('#svg .hex', a => a.length);
  await page.goto(BASE + '?drill=1&level=8&seed=7&players=3', { waitUntil: 'networkidle' });
  t = await text(); assert.match(t, /Last to pick[\s\S]*3 players · you are seat 3/); assert.deepEqual(await counts(), { badges: 0, opp: 2, me: 0 });
  const hexes3 = await page.$$eval('#svg .hex', a => a.length);
  assert.ok(hexes6 > hexes3, `6-player board bigger than 3-player (${hexes6} vs ${hexes3})`);
  await page.goto(BASE + '?drill=1&level=17&seed=7&players=4', { waitUntil: 'networkidle' });
  assert.match(await text(), /Level 17 · bonus[\s\S]*hardest level repeats/);
  console.log('same level on 3-player and 6-player C&K tables: seats, pieces and board size follow the table');
  // level track: flags per table (4-base has 1, 2, 10; 6-cak has 1), current ring, locked beyond next, persists across reload
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': [1, 2, 10], '6-cak': [1] } })));
  await page.goto(BASE + '?drill=1&level=3&players=4', { waitUntil: 'networkidle' });
  const track = () => page.$$eval('#panel .track li', a => a.map(li => ({ n: +li.dataset.level, cl: li.classList.contains('cleared'), cur: li.classList.contains('current'), locked: li.classList.contains('locked') })));
  let tr = await track();
  assert.equal(tr.length, 16); assert.deepEqual(tr.filter(x => x.cl).map(x => x.n), [1, 2, 10]);
  assert.ok(tr[2].cur && !tr[2].locked); assert.ok(!tr[10].locked && tr[11].locked && tr[15].locked);   // open through 11 (one past the highest flag)
  assert.match(await text(), /3 of 16 cleared · 4 players, base game/);
  await page.click('#panel .track li[data-level="16"]');            // locked: nothing happens
  assert.equal(q().level, '3');
  await page.click('#panel .track li[data-level="1"]');             // cleared: replay it
  assert.equal(q().level, '1'); assert.match(await text(), /Level 1 of 16/);
  await page.goto(BASE + '?drill=1&level=15&players=4', { waitUntil: 'networkidle' });   // a link cannot skip ahead: clamped to the next unlocked level
  assert.equal(q().level, '11'); tr = await track(); assert.ok(tr[10].cur && !tr[10].locked);
  await page.goto(BASE + '?drill=1&level=15&players=6&cak=1', { waitUntil: 'networkidle' });   // another table has its own progress: only level 1 cleared there
  assert.equal(q().level, '2'); tr = await track(); assert.deepEqual(tr.filter(x => x.cl).map(x => x.n), [1]); assert.match(await text(), /1 of 16 cleared · 6 players, Cities & Knights/);
  await page.goto(BASE + '?drill=1&level=99999999&players=4', { waitUntil: 'networkidle' });   // hand-edited link is capped
  assert.equal(q().level, '11'); assert.equal((await track()).length, 16);
  // old-format progress from the mixed ladder is ignored, not crashed on
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ cleared: [1, 2, 3, 4, 5] })));
  await page.goto(BASE + '?drill=1&level=6&players=4', { waitUntil: 'networkidle' });
  assert.equal(q().level, '1'); assert.equal((await track()).filter(x => x.cl).length, 0);
  // setup card resumes at the next open level of the chosen table
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': [1, 2, 3], '6-cak': [1] } })));
  await page.goto(BASE + '?players=4&seed=7', { waitUntil: 'networkidle' });
  await page.click('#drill'); assert.match(await text(), /3 of 16 cleared, you resume at level 4/);
  await showSettings(page); await page.click('#players button:nth-child(4)'); await showSettings(page); await page.click('#cak'); assert.match(await text(), /1 of 16 cleared, you resume at level 2/);
  await page.click('#start-drill'); p = q(); assert.equal(p.level, '2'); assert.equal(p.players, '6'); assert.equal(p.cak, '1'); assert.match(await text(), /Level 2 of 16[\s\S]*6 players · you are seat 1 · Cities & Knights/);
  await page.click('#restart-levels');
  assert.equal(q().level, '1'); assert.equal((await track()).filter(x => x.cl).length, 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('catan-lens.levels')));
  assert.deepEqual(saved, { ladders: { '4-base': [1, 2, 3] } });   // start-over wipes only this table's track
  console.log('level track: flags per table, locked/cleared/current right, resume level on the setup card, start over is per table');
  // drill off restores a free board with controls (from a level, and from the setup card)
  await page.click('#drill');
  p = q(); assert.equal(p.drill, undefined); assert.ok(!(await disabled('#players button'))); assert.ok(!(await disabled('#seed')));
  assert.match(await text(), /Mark opponent/);
  await page.click('#drill'); assert.match(await text(), /set your table/); await page.click('#drill');
  assert.equal(q().drill, undefined); assert.match(await text(), /Mark opponent/); assert.ok(!(await disabled('#seat button')));
  console.log('drill off restores free play, from a level and from setup');
  await page.goto(BASE + '?drill=1&level=5&seed=7&players=4', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'drill-stage5.png', fullPage: true });
  await browser.close();
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log('DRILL E2E OK, zero page errors');
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });

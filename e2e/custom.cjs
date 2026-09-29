const { showSettings, BASE } = require('./helpers.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const q = () => Object.fromEntries(new URL(page.url()).searchParams);
  const text = () => page.$eval('#panel', el => el.innerText);
  const hexClass = i => page.$eval(`#svg .hex >> nth=${i}`, e => e.getAttribute('class'));
  const clickHex = i => page.$eval(`#svg .hex >> nth=${i}`, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const disabled = sel => page.$eval(sel, b => b.disabled);
  const part = i => (q().b.match(/[wbhsod-]\d{0,2}/g) || [])[i];   // hex i as encoded in the link
  const H = 1;   // seed 42, hex 1 is sheep 5 (hex 0 is already ore 8, so it would not show a change)

  await page.goto(BASE + '?seed=42&players=4&seat=1', { waitUntil: 'networkidle' });
  const seedBoard = await page.$$eval('#svg .hex', a => a.map(e => e.getAttribute('class')));
  await page.click('#custom');
  let p = q(); assert.equal(p.seed, undefined); assert.match(p.b, /^[wbhsod-](\d{1,2})?([wbhsod-](\d{1,2})?){18}$/); assert.ok(p.h && p.h.split(',').length === 9, 'nine harbours carried in the link');
  let t = await text(); assert.match(t, /Your board[\s\S]*enter the board in front of you[\s\S]*Matches the official box/); assert.match(t, /Place mine/);
  assert.deepEqual(await page.$$eval('#svg .hex', a => a.map(e => e.getAttribute('class').replace(' editable', ''))), seedBoard, 'starts from the board on screen');
  assert.ok(await disabled('#seed')); assert.ok(await disabled('#balanced')); assert.ok(!(await disabled('#players button')));
  assert.equal(await page.$eval('#new', b => b.textContent), 'Random board');
  console.log('Your board on: starts from the current board, link carries it, box check clean');
  // paint: pick Ore, tap hex 0 → ore; the check now complains; the pick tool locks corners
  assert.match(await hexClass(H), /\bsheep\b/); assert.equal(part(H), 's5');
  await page.click('#tool-ore'); await clickHex(H);
  assert.match(await hexClass(H), /\bore\b/); assert.equal(part(H), 'o5');
  t = await text(); assert.match(t, /ore: 4 hexes entered, the box has 3/); assert.match(t, /sheep: 3 hexes entered, the box has 4/);
  const corner = await page.$('#svg .vx.legal'); assert.equal(corner, null, 'corners inert while a paint is active');
  await page.click('#tool-ore'); assert.ok(await page.$('#svg .vx.legal'), 'corners back when the paint is put down');
  console.log('painting works, box check reacts, corners lock while painting');
  // numbers: tool → tap hex 0 → picker → 8
  await page.click('#tool-number'); assert.match(await text(), /Tap a hex to set its number/);
  await clickHex(H); t = await text(); assert.match(t, /Token for the ore hex/); assert.match(await hexClass(H), /\bsel\b/);
  await page.click('.picker button[data-num="8"]');
  assert.equal(part(H), 'o8'); assert.match(await text(), /number 8: 3 placed, the box has 2/);
  await page.click('.picker button[data-num="0"]'); assert.equal(part(H), 'o');
  await page.click('.picker button[data-num="8"]');
  // desert paint clears the number
  await page.click('#tool-desert'); await clickHex(H); assert.equal(part(H), 'd'); await page.click('#tool-ore'); await clickHex(H); await page.click('#tool-ore');
  console.log('number picker sets, clears, and desert wipes the token');
  // ports: every coastal edge is a target; tapping cycles none → 3:1 → wood → … ; the link follows
  await page.click('#tool-port');
  const hits = await page.$$eval('#svg .coast-hit', a => a.length); assert.ok(hits >= 20, `coastal targets drawn (${hits})`);
  const empty = await page.$eval('#svg .coast-hit.empty', e => e.dataset.edge);
  const tap = () => page.$eval(`#svg .coast-hit[data-edge="${empty}"]`, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await tap(); assert.ok(q().h.split(',').includes(`${empty}:3`)); assert.match(await text(), /10 harbours placed, the box has 9/);
  await tap(); assert.ok(q().h.split(',').includes(`${empty}:w`));
  for (let i = 0; i < 5; i++) await tap();   // brick, wheat, sheep, ore, none
  assert.ok(!q().h.split(',').some(x => x.startsWith(`${empty}:`))); assert.doesNotMatch(await text(), /10 harbours/);
  await page.click('#tool-port');
  console.log('ports cycle on coastal edges and the link follows');
  // reload the link: same board, still in Your board mode; ranking works and a settlement can be placed
  const link = page.url(); const bBefore = q().b;
  await page.goto(link, { waitUntil: 'networkidle' });
  assert.equal(q().b, bBefore); assert.equal(await page.$eval('#custom', b => b.getAttribute('aria-pressed')), 'true'); assert.match(await text(), /Your board/);
  assert.match(await text(), /Best first settlement/);
  await page.$eval('#svg .vx.legal', c => c.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await page.click('#keep');
  assert.match(await text(), /Your first settlement/); assert.ok(q().me);
  console.log('reload keeps the board; placing works on it');
  // start blank: all hexes blank, no harbours, check says so, no crash with zero production
  await page.click('#blank-board');
  assert.ok((await page.$$eval('#svg .hex.blank', a => a.length)) === 19); assert.equal(q().h, undefined); assert.match(await text(), /19 hexes are still blank/);
  await page.click('#tool-wheat'); await clickHex(9); await page.click('#tool-number'); await clickHex(9); await page.click('.picker button[data-num="6"]');
  assert.equal(await page.$$eval('#svg .tok', a => a.length), 1);
  console.log('blank board, one wheat 6 painted, no errors');
  // players 6 → bigger board keeps the entered hexes and adds blanks
  await showSettings(page); await page.click('#players button:nth-child(4)');
  assert.equal(await page.$$eval('#svg .hex', a => a.length), 30); assert.equal(q().players, '6'); assert.match(q().b, /h6/);
  await showSettings(page); await page.click('#players button:nth-child(2)');
  // drill on leaves Your board; drill off returns to a random board, not the entered one
  await page.click('#drill'); assert.equal(await page.$eval('#custom', b => b.getAttribute('aria-pressed')), 'false'); assert.ok(await disabled('#custom')); assert.match(await text(), /set your table/);
  await page.click('#drill'); assert.equal(q().b, undefined); assert.ok(q().seed);
  // Your board off from free play → random board with a seed
  await page.click('#custom'); assert.ok(q().b); await page.click('#custom'); assert.equal(q().b, undefined); assert.ok(q().seed); assert.ok(!(await disabled('#seed')));
  console.log('mode switches: drill leaves Your board; off returns to random boards');
  // hostile link: bad board string is ignored, page stays up
  await page.goto(BASE + '?players=4&b=zzz&h=1:q', { waitUntil: 'networkidle' });
  assert.equal(q().b, undefined); assert.equal(await page.$eval('#custom', b => b.getAttribute('aria-pressed')), 'false');
  await page.goto(BASE + '?players=4&b=' + 'w8'.repeat(19) + '&h=99999:3', { waitUntil: 'networkidle' });
  assert.equal(q().b, undefined);
  await browser.close();
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log('CUSTOM E2E OK, zero page errors');
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });

const { showDraft } = require('./helpers.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const base = require('./helpers.cjs').BASE;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const badges = () => page.$$eval('#svg .badge', a => a.map(g => ({ seat: g.querySelector('text').textContent, r2: g.classList.contains('r2'), you: g.classList.contains('you'), placed: g.classList.contains('placed'), cx: +g.querySelector('circle').getAttribute('cx'), cy: +g.querySelector('circle').getAttribute('cy') })));
  for (const [players, seat] of [[3, 2], [4, 3], [6, 5]]) {
    await page.goto(base + `?seed=42&players=${players}&seat=${seat}`, { waitUntil: 'networkidle' });
    assert.equal((await badges()).length, 0, 'projections start closed');
    await showDraft(page);
    await page.waitForFunction(n => document.querySelectorAll('#svg .badge').length === n, players * 2);
    const b = await badges();
    assert.equal(b.length, players * 2, `${players}p badges ${b.length}`);
    assert.deepEqual(b.map(x => x.seat), [...Array.from({ length: players }, (_, i) => String(i + 1)), ...Array.from({ length: players }, (_, i) => String(players - i))]);
    assert.equal(b.filter(x => x.r2).length, players); assert.equal(b.filter(x => x.you).length, 2);
    assert.ok(b.filter(x => x.you).every(x => x.seat === String(seat)));
    const rows = await page.$$eval('#panel .rank.draft li', a => a.length);
    assert.equal(rows, players * 2);
    const t = await page.$eval('#panel', el => el.innerText);
    assert.match(t, /Projected placements/); assert.doesNotMatch(t, /Top \d corners/);
    // no two projected corners share a spot or touch: each badge centre is > 0.9 units from every other (adjacent corners are 1 unit apart)
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const d = Math.hypot(b[i].cx - b[j].cx, b[i].cy - b[j].cy); assert.ok(d > 1.2, `${players}p badges ${i},${j} too close (${d.toFixed(2)})`); }
    console.log(`${players} players, seat ${seat}: ${b.length} badges in snake order, rows ${rows}, you highlighted`);
    await page.locator('[data-disclosure="draft"] > summary').click();
    await page.waitForFunction(() => document.querySelectorAll('#svg .badge').length === 0);
  }
  // Placed pieces are consumed in turn order: I am seat 2, mark seat 1's corner, then keep my first
  await page.goto(base + '?seed=42&players=4&seat=2', { waitUntil: 'networkidle' });
  await page.click('#mode-opp');
  await page.$$eval('#svg .vx.legal', a => a[7].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.click('#mode-me');
  await showDraft(page); await page.click('#panel .rank.draft li:nth-child(2)');     // my projected first pick → preview
  let t = await page.$eval('#panel', el => el.innerText);
  assert.match(t, /Your pick/);
  await page.click('#keep');
  let b = await badges();
  assert.equal(b.length, 8);
  assert.deepEqual(b.slice(0, 2).map(x => [x.seat, x.placed, x.you]), [['1', true, false], ['2', true, true]]);
  assert.ok(b.slice(2).every(x => !x.placed));
  t = await page.$eval('#panel', el => el.innerText);
  assert.match(t, /Your first settlement[\s\S]*(Great|Good|Fair|Weak) pick/);
  assert.equal((t.match(/placed/g) || []).length, 2, 'two rows marked placed');
  console.log('placed pieces consumed in turn order; verdict card still shown');
  // Show best off hides badges and the projection card
  await page.goto(base + '?seed=42&players=4&seat=2&best=0', { waitUntil: 'networkidle' });
  assert.equal((await badges()).length, 0);
  assert.doesNotMatch(await page.$eval('#panel', el => el.innerText), /Projected placements/);
  console.log('show best off hides the projection');
  await page.goto(base + '?seed=42&players=4&seat=3', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'draft.png', fullPage: true });
  await page.goto(base + '?seed=42&players=6&seat=5', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'draft6.png' });
  await browser.close();
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log('E2E OK, zero page errors');
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });

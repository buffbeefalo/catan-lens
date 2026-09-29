const { showSettings, showDraft } = require('./helpers.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const base = require('./helpers.cjs').BASE;
  const q = () => Object.fromEntries(new URL(page.url()).searchParams);
  const text = () => page.$eval('#panel', el => el.innerText);
  const counts = () => page.evaluate(() => ({ opp: document.querySelectorAll('#svg .piece.opp').length, me: document.querySelectorAll('#svg .piece.me').length, hits: document.querySelectorAll('#svg .vx.legal').length }));
  // 1. Reload keeps the placement order: mine first, then an opponent → Undo after reload removes the opponent
  await page.goto(base + '?seed=42&players=4&seat=1', { waitUntil: 'networkidle' });
  await showDraft(page); await page.click('#panel .rank li:nth-child(1)'); await page.click('#keep');
  const liveVerdict = (await text()).match(/Your first settlement\s+(#\d+ of \d+)/)[1];
  await page.click('#mode-opp'); await page.$$eval('#svg .vx.legal', a => a[3].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  assert.match(q().seq, /^m\d+,o\d+$/);
  await page.goto(page.url(), { waitUntil: 'networkidle' });
  assert.equal((await text()).match(/Your first settlement\s+(#\d+ of \d+)/)[1], liveVerdict, 'verdict unchanged after reload');
  await page.click('#undo');
  assert.deepEqual(await counts().then(c => [c.me, c.opp]), [1, 0]);
  console.log('reload keeps order; verdict stable; undo removes the opponent');
  // 2. Hostile links do not crash the page
  for (const bad of ['?seed=42&me=-1', '?seed=42&opp=-1', '?seed=42&me=5,5', '?seed=42&me=5&opp=5', '?seed=42&me=999', '?seed=abc', '?seed=&seat=2.5', '?seed=42&seq=m-1,o5,m5,mx']) {
    await page.goto(base + bad, { waitUntil: 'networkidle' });
    assert.ok((await counts()).hits > 0, bad + ': board alive'); assert.match(await text(), /Best first settlement|Now the second settlement|Your opening/, bad + ': panel rendered');
  }
  await page.goto(base + '?seed=42&seat=2.5', { waitUntil: 'networkidle' }); assert.equal(q().seat, '2', 'fractional seat floored');
  console.log('hostile links survive');
  // 3. Balanced toggle clears pieces (numbers can move under them); seed field validation; hex tooltips per hex
  await page.goto(base + '?seed=2&players=4&seat=1', { waitUntil: 'networkidle' });
  await showDraft(page); await page.click('#panel .rank li:nth-child(1)'); await page.click('#keep');
  await showSettings(page); await page.click('#balanced'); assert.equal((await counts()).me, 0);
  await showSettings(page); await page.fill('#seed', 'abc'); await showSettings(page); await page.press('#seed', 'Enter'); await page.$eval('#seed', e => e.blur());
  assert.equal(await page.$eval('#seed', e => e.value), '2', 'invalid seed restored');
  await showSettings(page); await page.fill('#seed', '4294967297'); await page.$eval('#seed', e => e.blur());
  assert.equal(await page.$eval('#seed', e => e.value), '2', 'oversized seed rejected');
  const titles = await page.$$eval('#svg polygon.hex', a => a.map(p => p.querySelector('title') && p.querySelector('title').textContent));
  assert.equal(titles.filter(Boolean).length, 19); assert.ok(new Set(titles).size > 5, 'per-hex tooltips');
  console.log('balanced clears pieces; seed field strict; tooltips per hex');
  // 4. Free play: once both settlements are down the board stops offering corners; opponents can still be marked
  await page.goto(base + '?seed=42&players=4&seat=1', { waitUntil: 'networkidle' });
  await showDraft(page); await page.click('#panel .rank li:nth-child(1)'); await page.click('#keep');
  await page.$$eval('#svg .vx.legal', a => a[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))); await page.click('#keep');
  assert.equal((await counts()).hits, 0, 'no clickable corners after two settlements');
  await page.click('#mode-opp'); assert.ok((await counts()).hits > 0, 'opponent marking still possible');
  console.log('dead corners are not offered');
  // 4b. A mouse drag across the map selects nothing (Chrome paints SVG text selection scaled by the viewBox into flashing blocks)
  await page.goto(base + '?seed=42&players=4&seat=1', { waitUntil: 'networkidle' });
  const bb = await page.$eval('#svg', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(bb.x + bb.w * 0.2, bb.y + bb.h * 0.2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(bb.x + bb.w * (0.2 + 0.05 * i), bb.y + bb.h * (0.2 + 0.05 * i));
  const dragSel = await page.evaluate(() => getSelection().toString());
  await page.mouse.up();
  assert.equal(dragSel, '', 'drag on the map must not select text, got: ' + dragSel);
  console.log('mouse drag on the map selects nothing');
  // 4c. Harbour labels never sit on a tile (any board size): sample each label's text box against every hex fill
  for (const u of ['?seed=42&players=4&seat=1', '?seed=7&players=6&seat=1', '?seed=99&players=6&seat=1', '?seed=3&players=4&seat=1']) {
    await page.goto(base + u, { waitUntil: 'networkidle' });
    const onTile = await page.evaluate(() => {
      const svg = document.querySelector('#svg'); const hexes = [...svg.querySelectorAll('.hex')]; const out = [];
      for (const t of svg.querySelectorAll('text.harbor')) {
        const b = t.getBBox(); const pts = [];
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 2; j++) pts.push([b.x + b.width * i / 8, b.y + b.height * j / 2]);
        if (hexes.some(h => pts.some(([x, y]) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return h.isPointInFill(p); }))) out.push(t.textContent);
      }
      return { out, n: svg.querySelectorAll('text.harbor').length };
    });
    assert.ok(onTile.n >= 9, 'harbour labels drawn'); assert.deepEqual(onTile.out, [], u + ': labels on a tile: ' + onTile.out.join(', '));
  }
  console.log('harbour labels clear of the tiles on four boards');
  // 5. Drill: seed field locked; leaving the drill restores your free-play settings
  await page.goto(base + '?seed=42&players=3&seat=2&cak=1', { waitUntil: 'networkidle' });
  await page.click('#drill'); assert.ok(await page.$eval('#seed', e => e.disabled));
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '6-cak': Array.from({ length: 16 }, (_, i) => i + 1) } })));
  await page.goto(base + '?drill=1&level=16&players=6&cak=1', { waitUntil: 'networkidle' }); assert.equal(q().players, '6'); assert.equal(q().cak, '1');   // the table comes from the link, never from the level
  await page.click('#drill');
  console.log('drill exit players', q().players, 'cak', q().cak);
  await page.goto(base + '?seed=42&players=3&seat=2&cak=1', { waitUntil: 'networkidle' });
  await page.click('#drill'); await page.click('#start-drill'); assert.equal(q().level, '1'); await page.click('#drill');
  assert.deepEqual([q().players, q().seat, q().cak], ['3', '2', '1'], 'settings restored on drill exit');
  console.log('drill exit restores free-play settings');
  await browser.close();
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log('AUDIT E2E OK, zero page errors');
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });

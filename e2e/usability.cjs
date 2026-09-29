const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const base = require('./helpers.cjs').BASE;
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
});
after(async () => { await browser?.close(); });

async function open(t, viewport, query = '?seed=42&players=4&seat=1') {
  const page = await browser.newPage({ viewport, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto(base + query, { waitUntil: 'networkidle' });
  return page;
}

test('a phone placement can be confirmed without searching below the board', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.locator('#svg .vx.legal').first().tap();
  const reachable = await page.$eval('#keep', el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  assert.ok(reachable, 'Keep must be visible and unobscured immediately after tapping a corner');
  await page.locator('#keep').tap();
  assert.equal(await page.locator('#svg .piece.me').count(), 1);
  assert.ok(new URL(page.url()).searchParams.has('me'), 'confirmation persists in the share link');
});

test('keyboard preview preserves a useful focus target through board redraw', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('#svg .vx.legal').first().focus();
  await page.keyboard.press('Enter');
  const focused = await page.evaluate(() => document.activeElement.matches('.vx.legal, #keep'));
  assert.ok(focused, 'preview must not drop keyboard focus onto the page body');
  assert.equal(await page.locator('#svg .piece.pick').count(), 1);
});

test('painting a custom hex works when the tap lands on its number token', async t => {
  const page = await open(t, { width: 904, height: 1200 });
  await page.locator('#custom').tap();
  await page.locator('#tool-ore').tap();
  const hex = page.locator('#svg .hex').nth(1);
  await hex.scrollIntoViewIfNeeded();
  const box = await hex.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL(url => url.searchParams.get('b')?.startsWith('o8o5'), { timeout: 3000 });
  const tiles = new URL(page.url()).searchParams.get('b').match(/[wbhsod-]\d{0,2}/g);
  assert.equal(tiles[1], 'o5', 'the number token must not intercept the paint tap');
});

test('confirmation stays visible after queued focus work on phone, Fold, and desktop', async t => {
  for (const [width, height] of [[344, 882], [390, 844], [768, 1024], [904, 1200], [1023, 900], [1024, 900], [1440, 900]]) {
    for (const players of [3, 6]) {
      const page = await open(t, { width, height }, `?seed=42&players=${players}`);
      const methods = [344, 768].includes(width) ? ['tap', 'Enter', 'Space'] : ['tap'];
      for (const method of methods) {
        await page.evaluate(() => scrollTo(0, document.querySelector('.board').getBoundingClientRect().top + scrollY + 80));
        const corner = page.locator('#svg .vx.legal').nth(5);
        const id = Number((await corner.getAttribute('aria-label')).replace('Corner ', ''));
        if (method === 'tap') await corner.tap();
        else { await corner.focus(); await page.keyboard.press(method); }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const actual = await page.$eval('#keep', el => {
          const r = el.getBoundingClientRect();
          return { id: Number(el.dataset.corner), focused: document.activeElement === el, visible: r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.deepEqual(actual, { id, focused: true, visible: true, overflow: false }, `${width}px / ${players} players / ${method}`);
        const order = await page.evaluate(() => {
          const pick = document.querySelector('.pick-card').getBoundingClientRect();
          const board = document.querySelector('.board').getBoundingClientRect();
          const best = document.querySelector('.best-card').getBoundingClientRect();
          return { belowBoard: pick.top >= board.bottom - 1, beforeBest: pick.top < best.top };
        });
        assert.ok(order.beforeBest);
        if (width <= 1023) assert.ok(order.belowBoard, 'preview follows the board without moving the board away from the tap');
        await page.locator('#cancel-pick').click();
        assert.equal(await page.locator('#svg .piece.me').count(), 0, 'cancel never confirms');
      }
      await page.close();
    }
  }
});

test('blind practice and drills keep neutral corner markers without leaking hints', async t => {
  for (const query of ['?seed=42&players=4&best=0', '?seed=42&players=6&drill=1&level=1']) {
    const page = await open(t, { width: 390, height: 844 }, query);
    const markers = await page.$$eval('.legal-dot', els => els.map(el => {
      const s = getComputedStyle(el);
      return [s.fill, s.stroke, s.opacity, el.getAttribute('r')].join('/');
    }));
    assert.equal(markers.length, await page.locator('.vx.legal').count());
    assert.equal(new Set(markers).size, 1, 'legal markers do not distinguish ranked corners');
    await page.locator('.vx.legal').nth(5).tap();
    assert.equal(await page.locator('.badge, #svg .road, [data-disclosure="draft"], #preview-best').count(), 0);
    assert.doesNotMatch(await page.locator('.pick-card').textContent(), /% of best|Score\s*\d|Why this corner|Road:/);
    assert.ok(await page.locator('#keep').isVisible());
    await page.close();
  }
});

test('projected board markers follow the disclosure through previews and hint toggles', async t => {
  const page = await open(t, { width: 1440, height: 900 });
  const draft = () => page.locator('[data-disclosure="draft"]');
  assert.equal(await draft().evaluate(el => el.open), false);
  assert.equal(await page.locator('#svg .badge').count(), 0, 'closed projections must leave the board clear');
  await draft().locator('summary').click();
  await page.waitForFunction(() => document.querySelectorAll('#svg .badge').length === 8);
  await draft().locator('button').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.pick-card').count(), 1);
  assert.equal(await draft().evaluate(el => el.open), true);
  assert.equal(await page.locator('#svg .badge').count(), 8);
  await page.locator('#cancel-pick').click();
  await page.locator('#showbest').click();
  assert.equal(await draft().count(), 0, 'hidden hints are removed, including disclosure contents');
  assert.equal(await page.locator('#svg .badge').count(), 0);
  await page.locator('#showbest').click();
  assert.equal(await draft().evaluate(el => el.open), true);
  assert.equal(await page.locator('#svg .badge').count(), 8, 'restored disclosure also restores its overlay');
  await draft().locator('summary').click();
  await page.waitForFunction(() => document.querySelectorAll('#svg .badge').length === 0);
  assert.ok(await draft().locator('summary').evaluate(el => document.activeElement === el), 'closing projections preserves keyboard focus');
  await page.locator('#preview-best').click();
  assert.equal(await draft().evaluate(el => el.open), false);
  assert.equal(await page.locator('#svg .badge').count(), 0, 'preview must not reopen the projection overlay');
});

test('the best open corner is ringed on the map exactly when the best card is shown', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  assert.equal(await page.locator('#svg .best-ring').count(), 1, 'Show best on: one ring on the map');
  const ringed = await page.locator('#svg .best-ring').getAttribute('data-corner');
  await page.locator('#preview-best').click();
  assert.equal(await page.locator('#keep').getAttribute('data-corner'), ringed, 'the ring marks the corner the best card describes');
  await page.locator('#keep').click();
  const second = await page.locator('#svg .best-ring').getAttribute('data-corner');
  assert.notEqual(second, ringed, 'after the first settlement the ring moves to the best second corner');
  await page.locator('#showbest').click();
  assert.equal(await page.locator('#svg .best-ring').count(), 0, 'Show best off: no ring (blind practice)');
  const drill = await open(t, { width: 1400, height: 900 }, '?drill=1&level=1&seed=7&players=4');
  assert.equal(await drill.locator('#svg .best-ring').count(), 0, 'an unanswered drill never shows the ring');
});

test('tied best corners are all ringed and the best card says it is a tie', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=16&players=5&seat=1');   // corners 25 and 30 score the same
  const rings = await page.locator('#svg .best-ring').evaluateAll(els => els.map(e => e.getAttribute('data-corner')).sort());
  assert.deepEqual(rings, ['25', '30']);
  assert.match(await page.locator('.best-card h2').innerText(), /tied with 1 other/);
});

test('the ring follows opponent marks, undo, restored links, keyboard selection and phone width', async t => {
  const page = await open(t, { width: 390, height: 844 });
  const ring = () => page.locator('#svg .best-ring').first().getAttribute('data-corner');
  const first = await ring();
  assert.match(await page.locator('#svg .best-ring').first().getAttribute('aria-label'), /^Best open corner: /, 'each ring has an accessible label');
  await page.locator('#mode-opp').tap();
  await page.locator(`#hits .vx.legal[aria-label="Corner ${first}"]`).dispatchEvent('click');   // an opponent takes the best corner
  const moved = await ring();
  assert.notEqual(moved, first, 'a taken corner is never ringed');
  await page.locator('#undo').tap();
  assert.equal(await ring(), first, 'undo restores the ring');
  await page.locator('#mode-me').tap();
  await page.locator(`#hits .vx.legal[aria-label="Corner ${first}"]`).focus();
  await page.keyboard.press('Enter');
  await page.locator('#keep').press('Enter');
  const second = await ring();
  const reload = await open(t, { width: 1400, height: 900 }, '?' + new URL(page.url()).searchParams.toString());
  assert.equal(await reload.locator('#svg .best-ring').first().getAttribute('data-corner'), second, 'a shared link restores the same ring');
});

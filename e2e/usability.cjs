const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { chromium, firefox, webkit } = require('playwright');

const { BASE: base, navigateHistory } = require('./helpers.cjs');
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

async function moveInBrowserHistory(page, delta) {
  await navigateHistory(page, () => page.evaluate(n => history.go(n), delta));
}

test('generated board replacements retain the prior board and placement order through refresh and history', async t => {
  for (const width of [390, 1400]) for (const action of ['new', 'balanced', 'seed']) {
    const page = await open(t, { width, height: 900 }, '?seed=42&players=4&seat=1&me=43&opp=0&seq=m43,o0');
    const original = page.url();
    if (action !== 'new') await page.locator('#settings summary').click();
    if (action === 'seed') { await page.locator('#seed').fill('77'); await page.locator('#seed').press('Tab'); }
    else await page.locator('#' + action).click();
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 0);
    assert.equal(await page.locator('#restore-board').count(), 1, action + ' must retain a recovery action');
    const replacement = page.url();
    assert.notEqual(replacement, original);
    await reloadInBrowser(page);
    await navigateHistory(page, () => page.locator('#restore-board').click());
    assert.equal(page.url(), original);
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2);
    await moveInBrowserHistory(page, 1);
    assert.equal(page.url(), replacement);
    await moveInBrowserHistory(page, -1);
    await page.locator('#undo').click();
    assert.equal(new URL(page.url()).searchParams.get('me'), '43');
    assert.equal(new URL(page.url()).searchParams.has('opp'), false, 'restored Undo follows the actual placement order');
    await page.close();
  }
});

test('cleared pieces can be restored on generated and custom boards without changing tiles or harbour choices', async t => {
  for (const custom of [false, true]) {
    const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&me=43&opp=0&seq=m43,o0');
    if (custom) { await page.locator('#custom').click(); await page.locator('#port-mode').click(); }
    const original = page.url();
    await page.locator('#reset').click();
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 0);
    assert.equal(await page.locator('#restore-board').count(), 1);
    assert.equal(await page.locator('#restore-board').innerText(), 'Restore cleared pieces');
    const cleared = new URL(page.url()).searchParams;
    for (const key of ['seed', 'b', 'h', 'ports']) assert.equal(cleared.get(key), new URL(original).searchParams.get(key));
    const entries = await page.evaluate(() => history.length);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => history.length), entries, 'clearing an empty board keeps the meaningful recovery point');
    await reloadInBrowser(page);
    await navigateHistory(page, () => page.locator('#restore-board').click());
    assert.equal(page.url(), original);
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2);
    await page.close();
  }
});

test('reentering the current seed keeps pieces and does not create a recovery checkpoint', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&me=43&opp=0&seq=m43,o0');
  const original = page.url(), entries = await page.evaluate(() => history.length);
  await page.locator('#settings summary').click();
  await page.locator('#seed').fill('042');
  await page.locator('#seed').press('Tab');
  assert.equal(page.url(), original);
  assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2);
  assert.equal(await page.locator('#seed').inputValue(), '42');
  assert.equal(await page.evaluate(() => history.length), entries);
});

test('a new preview board during drill setup keeps the original free-play return after refresh', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&me=43&opp=0&seq=m43,o0');
  const original = page.url();
  await page.locator('#drill').click();
  await page.locator('#new').click();
  await reloadInBrowser(page);
  assert.equal(new URL(page.url()).searchParams.get('setup'), '1');
  await page.locator('#practice').click();
  assert.equal(page.url(), original);
  assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2);
});

async function cornerPoint(page, id, dx = 0, dy = 0) {
  return page.locator(`.vx[aria-label="Corner ${id}"]`).evaluate((el, offset) => {
    const p = new DOMPoint(Number(el.getAttribute('cx')), Number(el.getAttribute('cy'))).matrixTransform(el.getScreenCTM());
    return { x: p.x + offset.dx, y: p.y + offset.dy };
  }, { dx, dy });
}

test('high-contrast palettes visibly distinguish selected modes, table choices and editing tools', async t => {
  for (const colorScheme of ['light', 'dark']) {
    const page = await open(t, { width: 1400, height: 900 });
    await page.emulateMedia({ forcedColors: 'active', colorScheme });
    if (!await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) { t.skip('This browser does not emulate forced colours'); return; }
    const distinguish = async (selected, other) => {
      const style = locator => page.locator(locator).first().evaluate(el => {
        const s = getComputedStyle(el); return { background: s.backgroundColor, text: s.color };
      });
      const a = await style(selected), b = await style(other);
      assert.notEqual(a.background, b.background, `${colorScheme}: ${selected} must remain visually selected`);
      assert.notEqual(a.text, a.background, `${colorScheme}: selected text must remain visible`);
    };
    await distinguish('#practice', '#drill');
    await page.locator('#settings summary').click();
    await distinguish('#players button[aria-pressed="true"]', '#players button[aria-pressed="false"]');
    await page.locator('#mode-opp').click();
    await distinguish('#mode-opp', '#mode-me');
    await page.locator('#custom').click();
    await page.locator('#tool-ore').click();
    await distinguish('#tool-ore', '#tool-wood');
    await page.close();
  }
});

test('high-contrast keyboard focus remains distinct from the page beside a coastal corner', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  if (!await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) { t.skip('This browser does not emulate forced colours'); return; }
  await page.getByRole('button', { name: 'Corner 0', exact: true }).focus();
  const { stroke, background } = await page.evaluate(() => ({ stroke: getComputedStyle(document.activeElement).stroke, background: getComputedStyle(document.body).backgroundColor }));
  const luminance = color => {
    const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const values = [luminance(stroke), luminance(background)].sort((a, b) => b - a);
  assert.ok((values[0] + .05) / (values[1] + .05) >= 3, 'the coastal focus stroke must contrast with the page at 3:1 or better');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#keep').getAttribute('data-corner'), '0');
});

test('a failed help transcript has an explicit retry and recovers without losing the board link', async t => {
  for (const failure of ['network', 'http', 'empty']) {
    const page = await open(t, { width: 390, height: 844 });
    let available = false;
    await page.route('**/media/overview.txt', route => available
      ? route.fulfill({ status: 200, contentType: 'text/plain', body: 'The recovered transcript explains the opening.' })
      : failure === 'network' ? route.abort('failed') : route.fulfill({ status: failure === 'http' ? 503 : 200, contentType: 'text/plain', body: failure === 'http' ? 'Unavailable' : '  ' }));
    await page.goto(base + 'how-it-works.html?seed=42&players=4', { waitUntil: 'networkidle' });
    const transcript = page.locator('[data-transcript="overview"]');
    await page.waitForFunction(() => document.querySelector('[data-transcript-status="overview"]').textContent.includes('could not be loaded'), null, { timeout: 2500 });
    const details = transcript.locator('..');
    if (!await details.evaluate(el => el.open)) await details.locator('summary').click();
    const retry = details.getByRole('button', { name: 'Retry transcript' });
    assert.equal(await retry.isVisible(), true);
    const otherTranscript = page.locator('[data-transcript="walkthrough"]'), otherDetails = otherTranscript.locator('..');
    if (!await otherDetails.evaluate(el => el.open)) await otherDetails.locator('summary').click();
    assert.ok((await otherTranscript.innerText()).length > 20, 'one failed transcript must not suppress the other');
    available = true;
    await retry.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-transcript="overview"]').textContent.includes('recovered transcript'), null, { timeout: 2500 });
    assert.equal(await retry.isVisible(), false);
    assert.equal(await details.locator('summary').evaluate(el => el === document.activeElement), true, 'successful retry must leave useful keyboard focus');
    assert.equal(new URL(await page.locator('#back-to-app').getAttribute('href'), page.url()).search, '?seed=42&players=4');
    await page.close();
  }
});

test('help video failures reveal a readable fallback and open the matching transcript', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.goto(base + 'how-it-works.html', { waitUntil: 'networkidle' });
  await page.locator('video').first().dispatchEvent('error');
  const notice = page.locator('[data-video-status="overview"]');
  assert.equal(await notice.count(), 1);
  assert.equal(await notice.isVisible(), true);
  assert.match(await notice.innerText(), /transcript|written guide/i);
  assert.equal(await page.locator('[data-transcript="overview"]').locator('..').evaluate(el => el.open), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('nearby phone taps and desktop clicks preview the closest corner across both board sizes', async t => {
  for (const width of [320, 390, 1400]) for (const players of [4, 6]) {
    const page = await open(t, { width, height: 1000 }, `?players=${players}&seed=42`);
    for (const id of [0, 5, 40]) for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
      await page.locator('#svg').scrollIntoViewIfNeeded();
      const p = await cornerPoint(page, id, dx, dy);
      if (width < 1000) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      assert.equal(await page.locator('#keep').getAttribute('data-corner'), String(id), `${width}px / ${players} players / corner ${id} / offset ${dx},${dy}`);
      await page.locator('#cancel-pick').click();
    }
    await page.close();
  }
});

test('taps nearest blocked corners or far from any corner do not redirect to another settlement', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?players=6&seed=42&opp=0&seq=o0');
  for (const id of [0, 1, 5]) {
    assert.equal(await page.locator(`.vx[aria-label="Corner ${id}"]`).getAttribute('aria-disabled'), 'true');
    const p = await cornerPoint(page, id, 8, 0);
    await page.touchscreen.tap(p.x, p.y);
    assert.equal(await page.locator('#keep').count(), 0, 'the closest blocked corner cannot redirect to a farther legal one');
    assert.equal(await page.locator('.piece.opp').count(), 1);
  }
  const middle = await page.locator('.hex').nth(10).boundingBox();
  await page.touchscreen.tap(middle.x + middle.width / 2, middle.y + middle.height / 2);
  assert.equal(await page.locator('#keep').count(), 0, 'a hex-centre tap is outside the corner reach');
  await page.locator('#mode-opp').click();
  const p = await cornerPoint(page, 40, -8, 0);
  await page.touchscreen.tap(p.x, p.y);
  assert.equal(new URL(page.url()).searchParams.get('opp'), '0,40', 'opponent marks use the same nearest-corner selection');
});

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

test('keyboard users can paint and number a hex without losing their place', async t => {
  for (const viewport of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
    const page = await open(t, viewport);
    const tile = () => new URL(page.url()).searchParams.get('b').match(/[wbhsod-]\d{0,2}/g)[1];
    await page.locator('#custom').press('Enter');
    await page.locator('#tool-ore').press('Enter');
    await page.locator('#settings summary').focus();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement.matches('.hex[role="button"]')), 'Tab must reach the board editor');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(tile(), 'o5', 'Enter paints the second tile');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.hex), '1', 'redrawing a painted tile preserves focus');
    assert.ok(await page.evaluate(() => document.activeElement.matches(':focus-visible')), 'the board shows keyboard focus');
    await page.locator('#tool-number').press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tool-number', 'redrawing the palette preserves focus');
    await page.locator('#settings summary').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.num), '5', 'opening the number picker focuses the current token');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(tile(), 'o6', 'the keyboard can change the token');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.num), '6', 'setting the token preserves focus');
    const visible = await page.evaluate(() => {
      const r = document.activeElement.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    assert.ok(visible, 'the focused token remains visible on a phone');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.hex), '1', 'Escape returns from the picker to its tile');
    await page.close();
  }
});

test('harbour labels do not intercept mouse clicks when painting a coastal hex', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('.vx.legal').first().click();
  await page.locator('#keep').click();
  await page.locator('#custom').click();
  await page.locator('#tool-wheat').click();
  const tile = page.locator('.hex').first();
  const bounds = await tile.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  assert.match(await tile.getAttribute('class'), /\bwheat\b/, 'a decorative harbour label must not capture the tile click');
});

test('keyboard users can cycle coastal harbours through redraws', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('#custom').press('Enter');
  await page.locator('#tool-port').press('Enter');
  await page.locator('#settings summary').focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement.matches('.coast-hit[role="button"]')), 'Tab must reach the harbour editor');
  for (let i = 0; i < 30 && !await page.evaluate(() => document.activeElement.matches('.coast-hit.empty')); i++) await page.keyboard.press('Tab');
  const edge = await page.evaluate(() => document.activeElement.dataset.edge);
  assert.ok(edge, 'an empty coastal edge is reachable');
  await page.keyboard.press('Enter');
  assert.ok(new URL(page.url()).searchParams.get('h').split(',').includes(`${edge}:3`));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.edge), edge);
  await page.keyboard.press('Space');
  assert.ok(new URL(page.url()).searchParams.get('h').split(',').includes(`${edge}:w`));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.edge), edge);
  assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /wood/i);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Space');
  assert.ok(!new URL(page.url()).searchParams.get('h').split(',').some(h => h.startsWith(`${edge}:`)), 'keyboard users can also remove a harbour');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.edge), edge);
});

test('drill levels are keyboard buttons with locked levels disabled', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': [1] } })));
  await page.goto(base + '?seed=42&players=4&drill=1&level=2', { waitUntil: 'networkidle' });
  const level = n => page.locator(`.track button[data-level="${n}"]`);
  assert.equal(await level(1).count(), 1, 'a cleared level is a real button');
  assert.match(await level(1).getAttribute('aria-label'), /Level 1.*cleared/i);
  assert.equal(await level(3).isDisabled(), true, 'a locked level exposes its disabled state');
  await level(1).press('Enter');
  assert.equal(new URL(page.url()).searchParams.get('level'), '1');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.level), '1', 'changing levels preserves keyboard focus');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  assert.equal(new URL(page.url()).searchParams.get('level'), '2');
  assert.equal(await level(2).getAttribute('aria-current'), 'step');
  assert.equal(await page.locator('#svg .best-ring, #preview-best, [data-disclosure="draft"]').count(), 0, 'keyboard replay keeps the drill blind');
});

test('failed progress saves stay visible and can be retried without losing another table or the unsaved result', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&drill=1&level=1');
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    window.allowProgressWrites = false;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'catan-lens.levels' && !window.allowProgressWrites) throw new DOMException('Blocked for test', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await reloadInBrowser(page);
  await page.getByRole('button', { name: 'Corner 43', exact: true }).press('Enter');
  await page.locator('#keep').click();
  assert.equal(await page.locator('.progress-warning').count(), 1, 'a failed save must be visible');
  assert.match(await page.locator('.progress-warning').innerText(), /could not save|couldn't save/i);
  assert.match(await page.locator('.progress-warning').innerText(), /reload|close/i);
  assert.equal(await page.locator('.track li.cleared').count(), 1, 'the answer remains cleared in this tab');
  assert.equal(await page.evaluate(() => localStorage.getItem('catan-lens.levels')), null);
  const other = await page.context().newPage();
  await other.goto(base);
  await other.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '6-cak': [1, 2] } })));
  await page.evaluate(() => { window.allowProgressWrites = true; });
  await page.locator('#retry-progress').press('Enter');
  assert.equal(await page.locator('.progress-warning').count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('catan-lens.levels'))), { ladders: { '4-base': [1], '6-cak': [1, 2] } });
  await page.locator('#next-stage').click();
  await reloadInBrowser(page);
  assert.equal(new URL(page.url()).searchParams.get('level'), '2');
  await other.close();
});

test('clearing browser storage in another tab refreshes the visible drill progress', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&drill=1&level=1');
  const other = await page.context().newPage();
  await other.goto(base);
  await other.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': [1, 2] } })));
  await page.waitForFunction(() => document.querySelectorAll('.track li.cleared').length === 2, null, { timeout: 2500 });
  await other.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => document.querySelectorAll('.track li.cleared').length === 0, null, { timeout: 2500 });
  assert.equal(await page.locator('.track button[data-level="2"]').isDisabled(), true);
  await other.close();
});

test('malformed saved level values cannot inflate cleared counts or unlock the bonus ladder', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': [1, 1, -2, 0, 999999] } })));
  await reloadInBrowser(page);
  await page.locator('#drill').click();
  assert.match(await page.locator('.setup-table').innerText(), /1 of 16 cleared, you resume at level 2/);
  await page.locator('#start-drill').click();
  assert.equal(new URL(page.url()).searchParams.get('level'), '2');
  assert.equal(await page.locator('.track li.cleared').count(), 1);
  assert.equal(await page.locator('.track button').count(), 16);
});

test('unreadable browser storage is reported and a later retry preserves the other saved tables', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&drill=1&level=1');
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '6-cak': [1] } })));
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    window.allowProgressReads = false;
    Storage.prototype.getItem = function(key) {
      if (key === 'catan-lens.levels' && !window.allowProgressReads) throw new DOMException('Blocked for test', 'SecurityError');
      return get.call(this, key);
    };
  });
  await reloadInBrowser(page);
  assert.equal(await page.locator('.progress-warning').count(), 1, 'a blocked read must be visible');
  assert.match(await page.locator('.progress-warning').innerText(), /could not read|couldn't read/i);
  await page.getByRole('button', { name: 'Corner 43', exact: true }).press('Enter');
  await page.locator('#keep').click();
  assert.equal(await page.locator('.track li.cleared').count(), 1);
  await page.evaluate(() => { window.allowProgressReads = true; });
  await page.locator('#retry-progress').click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('catan-lens.levels'))), { ladders: { '4-base': [1], '6-cak': [1] } });
});

test('a failed table reset can be saved later without restoring old levels or deleting another table', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&drill=1&level=1');
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': [1, 2], '6-cak': [1] } })));
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    window.allowProgressWrites = false;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'catan-lens.levels' && !window.allowProgressWrites) throw new DOMException('Blocked for test', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await reloadInBrowser(page);
  await page.locator('#restart-levels').click();
  assert.equal(await page.locator('.track li.cleared').count(), 0);
  assert.equal(await page.locator('.progress-warning').count(), 1);
  await page.evaluate(() => { window.allowProgressWrites = true; });
  await page.locator('#retry-progress').click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('catan-lens.levels'))), { ladders: { '6-cak': [1] } });
  await reloadInBrowser(page);
  assert.equal(await page.locator('.track li.cleared').count(), 0);
});

test('unreadable saved progress is left untouched until an explicit saving action', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?seed=42&players=4&drill=1&level=1');
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', '{broken'));
  await reloadInBrowser(page);
  assert.equal(await page.locator('.progress-warning').count(), 1);
  assert.match(await page.locator('.progress-warning').innerText(), /replaces the unreadable record/);
  assert.equal(await page.evaluate(() => localStorage.getItem('catan-lens.levels')), '{broken');
  await page.locator('#retry-progress').click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('catan-lens.levels'))), { ladders: {} });
  assert.equal(await page.locator('.progress-warning').count(), 0);
});

test('near-tie drill feedback shows the point gap and precise score only after committing', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': Array.from({ length: 14 }, (_, i) => i + 1) } })));
  await page.goto(base + '?players=4&drill=1&level=15&seed=1', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Corner 31', exact: true }).press('Enter');
  assert.doesNotMatch(await page.locator('.pick-card').innerText(), /99\.5%|11\.98|0\.06 points/);
  assert.equal(await page.locator('.opening-preview, .opening-facts').count(), 0, 'an unanswered second-settlement drill must not reveal the opening analysis');
  await page.locator('#keep').click();
  const result = await page.locator('.card.drill.fail .grade').innerText();
  assert.match(result, /99\.5%/);
  assert.match(result, /0\.06 points/);
  assert.match(result, /close model score/i);
  assert.doesNotMatch(result, /100%/);
  assert.equal(await page.locator('.verdict .stat span').first().innerText(), 'Score 11.98');
  assert.match(await page.locator('.verdict .grade').innerText(), /Good pick/);
  assert.equal(await page.locator('#next-stage').count(), 0);
  assert.equal(await page.locator('.opening-card').count(), 1, 'opening facts are available once the drill answer is committed');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'drill-result', 'drill feedback takes focus before the opening details');
});

test('duplicate harbour access is explained without extra trade credit or blind-preview hints', async t => {
  for (const showBest of [true, false]) {
    const page = await open(t, { width: 390, height: 844 }, `?players=4&seat=1&seed=42&me=0&seq=m0&best=${showBest ? 1 : 0}`);
    await page.getByRole('button', { name: 'Corner 16', exact: true }).press('Enter');
    const pick = page.locator('.pick-card');
    if (showBest) {
      await pick.locator('[data-disclosure="pick"] summary').click();
      assert.match(await pick.innerText(), /already have 3:1 port access/);
      assert.match(await pick.innerText(), /adds no port bonus/);
    } else {
      assert.doesNotMatch(await pick.textContent(), /already have|trade rate|port bonus/);
    }
    await page.locator('#keep').click();
    assert.match(await page.locator('.verdict').nth(1).innerText(), /already have 3:1 port access/);
    assert.match(await page.locator('.opening-rates').innerText(), /3:1/);
    assert.doesNotMatch(await page.locator('.opening-rates').innerText(), /2:1/);
    await reloadInBrowser(page);
    assert.match(await page.locator('.verdict').nth(1).innerText(), /adds no port bonus/);
    assert.equal(new URL(page.url()).searchParams.get('me'), '0,16');
    await page.close();
  }
});

test('the completed opening explains income, starting cards and build dependencies on a phone', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?players=4&seat=3&seed=4&me=42,4&seq=m42,m4');
  assert.equal(await page.locator('.opening-card').count(), 1);
  const card = page.locator('.opening-card');
  assert.match(await card.innerText(), /20.*cards.*36 rolls/i);
  assert.match(await card.innerText(), /20 of 36/);
  assert.match(await card.innerText(), /1 brick and 1 sheep/);
  assert.match(await card.innerText(), /no wheat income/i);
  assert.match(await card.innerText(), /no ore income/i);
  assert.equal(await card.locator('[data-resource="sheep"] .income-value').innerText(), '11');
  await card.locator('.opening-builds > summary').click();
  assert.match(await card.locator('[data-build="settlement"]').innerText(), /1 wood and 1 wheat/);
  assert.match(await card.locator('[data-build="city"]').innerText(), /2 wheat and 3 ore/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test('the second-pick opening preview agrees with the committed summary and stays hidden in blind practice', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?players=4&seat=2&seed=18&me=9&seq=m9');
  await page.getByRole('button', { name: 'Corner 44', exact: true }).press('Enter');
  assert.equal(await page.locator('.opening-preview').count(), 1);
  await page.locator('.opening-preview > summary').click();
  const before = await page.locator('.opening-preview .opening-facts').innerText();
  assert.match(before, /22.*cards.*36 rolls/i);
  assert.match(before, /14 of 36/);
  await page.locator('#keep').click();
  assert.equal(await page.locator('.opening-card .opening-facts').innerText(), before);
  assert.ok(await page.evaluate(() => document.activeElement.matches('.opening-card h2')), 'confirmation focuses the opening result');
  assert.ok(await page.locator('.opening-resources').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), 'the full income breakdown is visible immediately after confirmation');
  await page.goto(base + '?players=4&seat=2&seed=18&me=9&seq=m9&best=0', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Corner 44', exact: true }).press('Enter');
  assert.equal(await page.locator('.opening-preview, .opening-facts').count(), 0);
  await page.locator('#keep').click();
  assert.equal(await page.locator('.opening-card').count(), 1, 'committed facts remain available after blind practice');
});

test('opening details use the selected harbour assumption and disappear while board input needs repair', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const board = generateBoard({ seed: 42 });
  const first = board.graph.perimeter[0], far = board.graph.perimeter[15];
  board.harbors = { [first]: '3:1', [far]: 'wood' };
  const ids = [board.graph.edges[first].v[0], board.graph.edges[far].v[0]];
  const query = new URLSearchParams({ players: 4, ...encodeBoard(board), me: ids.join(','), seq: ids.map(id => 'm' + id).join(','), ports: 'entered' });
  const page = await open(t, { width: 1400, height: 900 }, '?' + query);
  assert.match(await page.locator('.opening-rates').innerText(), /wood.*2:1/i);
  await page.locator('#port-mode').click();
  assert.match(await page.locator('.opening-rates').innerText(), /4:1/);
  assert.doesNotMatch(await page.locator('.opening-rates').innerText(), /2:1|3:1/);
  assert.match(await page.locator('.opening-facts').innerText(), /harbour effects excluded/i);
  await page.locator('#tool-number').click();
  await page.locator('.hex[data-hex="0"]').press('Enter');
  await page.locator('.picker button[data-num="0"]').click();
  assert.equal(await page.locator('.opening-card, .opening-preview').count(), 0);
  assert.equal(await page.locator('.piece.me').count(), 2);
});

test('Cities and Knights opening figures clearly retain the two-settlement model boundary', async t => {
  const page = await open(t, { width: 390, height: 844 }, '?players=4&seat=2&seed=18&me=9,44&seq=m9,m44&cak=1');
  assert.equal(await page.locator('.opening-card').count(), 1);
  const card = page.locator('.opening-card');
  assert.match(await card.innerText(), /two settlements/i);
  assert.match(await card.innerText(), /starting city.*commodities/i);
  assert.equal(await card.locator('.opening-income, .opening-builds').count(), 0, 'base-game projections must not claim to model the C&K starting city');
});

test('the help return link preserves the latest edited board, harbour choice and placement order after reload', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const query = new URLSearchParams({ players: 4, seat: 2, ...encodeBoard(generateBoard({ seed: 42 })), ports: 'ignore', me: 41, opp: 0, seq: 'm41,o0' });
  const page = await open(t, { width: 390, height: 844 }, '?' + query);
  await page.locator('#tool-wheat').click();
  await page.locator('.hex[data-hex="0"]').press('Enter');
  const before = new URL(page.url());
  await page.getByRole('link', { name: 'How it works', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(new URL(page.url()).search, before.search, 'the help link carries the latest board state');
  await reloadInBrowser(page);
  await page.getByRole('link', { name: /Back to the app/ }).click();
  await page.waitForLoadState('networkidle');
  assert.equal(new URL(page.url()).search, before.search);
  assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.piece.me').count(), 1);
  assert.equal(await page.locator('.piece.opp').count(), 1);
  await page.locator('#undo').click();
  assert.equal(await page.locator('.piece.me').count(), 1);
  assert.equal(await page.locator('.piece.opp').count(), 0, 'Undo still reverses the last placement');
});

test('help preserves an unreadable link verbatim and its return stays within this app', async t => {
  const query = '?players=4&b=%ZZ%3Cscript%3E&h=5%3A3%2C5%3Aw&me=41&return=https%3A%2F%2Fexample.invalid%2F';
  const page = await open(t, { width: 1400, height: 900 }, query);
  assert.equal(await page.locator('.link-error').count(), 1);
  const before = new URL(page.url());
  await page.getByRole('link', { name: 'How it works', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(new URL(page.url()).search, query);
  const back = new URL(await page.getByRole('link', { name: /Back to the app/ }).getAttribute('href'), page.url());
  assert.equal(back.origin, before.origin);
  assert.equal(back.pathname, before.pathname);
  await page.getByRole('link', { name: /Back to the app/ }).click();
  await page.waitForLoadState('networkidle');
  assert.equal(new URL(page.url()).search, query);
  assert.equal(await page.locator('.link-error').count(), 1);
  assert.equal(await page.locator('.best-ring').count(), 0);
});

test('the evidence page separates the harbour correction from earlier benchmarks on phones', async t => {
  for (const width of [320, 1400]) {
    const page = await open(t, { width, height: 900 }, 'how-it-works.html');
    const corrected = page.locator('#owned-harbour-results');
    assert.equal(await corrected.locator('tbody tr').count(), 3);
    assert.match(await corrected.innerText(), /1,972 wins/);
    assert.match(await corrected.innerText(), /1,976 wins/);
    assert.match(await page.locator('#owned-harbour-comparison').innerText(), /four fewer wins/i);
    assert.match(await page.locator('#owned-harbour-comparison').innerText(), /−0\.098 to −0\.002/);
    assert.doesNotMatch(await page.locator('#policy-version-note').innerText(), /in progress/i);
    const fresh = page.locator('#holdout-results');
    assert.equal(await fresh.locator('tbody tr').count(), 5);
    assert.match(await fresh.innerText(), /24\.3%.*1\.1/);
    assert.match(await fresh.innerText(), /16\.4%.*1\.1/);
    assert.match(await fresh.locator('caption').innerText(), /8,000 games per strategy/);
    assert.match(await page.locator('#benchmark-limits').innerText(), /four-player base game/);
    assert.match(await page.locator('#paired-results').innerText(), /6\.5.*9\.3/);
    await page.locator('#original-results > summary').click();
    assert.match(await page.locator('#results').innerText(), /25\.2%.*1\.2/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'benchmark tables fit the phone width');
    await page.close();
  }
});

test('the evidence page explains a results download failure instead of leaving an empty table', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.route('**/media/results.json', route => route.abort());
  await page.goto(base + 'how-it-works.html', { waitUntil: 'networkidle' });
  assert.match(await page.locator('#results-status').innerText(), /could not be loaded/i);
  assert.equal(await page.locator('#owned-harbour-results tbody tr').count(), 0);
  assert.ok(await page.getByRole('link', { name: /benchmark methods and records/i }).isVisible());
});

test('editing a custom board preserves placement order for Undo', async t => {
  const page = await open(t, { width: 1400, height: 900 });
  await page.locator('#custom').click();
  await page.locator('#preview-best').click();
  await page.locator('#keep').click();
  await page.locator('#mode-opp').click();
  await page.locator('.vx.legal').first().click();
  const order = new URL(page.url()).searchParams.get('seq');
  assert.match(order, /^m\d+,o\d+$/);
  await page.locator('#tool-ore').click();
  await page.locator('.hex').nth(1).press('Enter');
  assert.equal(new URL(page.url()).searchParams.get('seq'), order, 'editing a tile must not rewrite who placed first');
  await page.locator('#undo').click();
  assert.equal(await page.locator('.piece.me').count(), 1, 'Undo keeps the earlier player settlement');
  assert.equal(await page.locator('.piece.opp').count(), 0, 'Undo removes the last opponent mark');
});

test('a drill roundtrip restores the entered or generated board and its placements', async t => {
  for (const custom of [false, true]) {
    const page = await open(t, { width: 1400, height: 900 });
    if (custom) {
      await page.locator('#custom').click();
      await page.locator('#tool-wheat').click();
      await page.locator('.hex').nth(1).press('Enter');
      await page.locator('#tool-wheat').click();
    }
    await page.locator('#preview-best').click();
    await page.locator('#keep').click();
    await page.locator('#mode-opp').click();
    await page.locator('.vx.legal').first().click();
    const before = new URL(page.url()).search;
    await page.locator('#drill').click();
    await page.locator('#settings summary').click();
    await page.locator('#players button').last().click();
    await page.locator('#cak').click();
    await page.locator('#start-drill').click();
    assert.equal(new URL(page.url()).searchParams.get('players'), '6');
    await page.locator('#practice').click();
    assert.equal(new URL(page.url()).search, before, 'leaving Drill restores the exact previous board, table and action order');
    assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), String(custom));
    assert.equal(await page.locator('#mode-opp').getAttribute('aria-pressed'), 'true', 'the previous placement tool is restored');
    await page.locator('#undo').click();
    assert.equal(await page.locator('.piece.me').count(), 1);
    assert.equal(await page.locator('.piece.opp').count(), 0);
    await page.close();
  }
});

test('reloading an active drill keeps the custom-board return point and the previous-board recovery', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.locator('#custom').click();
  const original = new URL(page.url()).search;
  await page.locator('#rand-board').click();
  await page.locator('#preview-best').click();
  await page.locator('#keep').click();
  await page.locator('#mode-opp').click();
  await page.locator('.vx.legal').first().press('Enter');
  const before = new URL(page.url()).search;
  await page.locator('#drill').click();
  await page.locator('#settings summary').click();
  await page.locator('#players button').last().click();
  await page.locator('#cak').click();
  await page.locator('#start-drill').click();
  const exercise = new URL(page.url()).search;
  await reloadInBrowser(page);
  assert.equal(new URL(page.url()).search, exercise);
  await page.locator('#practice').click();
  assert.equal(new URL(page.url()).search, before, 'reload must retain the board, table and placement order from before Drill');
  assert.equal(await page.locator('#mode-opp').getAttribute('aria-pressed'), 'true');
  await page.locator('#undo').click();
  assert.equal(await page.locator('.piece.me').count(), 1);
  assert.equal(await page.locator('.piece.opp').count(), 0);
  await page.locator('#restore-board').click();
  await page.waitForLoadState('networkidle');
  assert.equal(new URL(page.url()).search, original, 'Drill does not overwrite the older recovery checkpoint');
});

test('drill setup survives reload and a copied drill link contains only its own table', async t => {
  const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=3&seat=2&me=41&opp=0&seq=m41,o0&best=0');
  const before = new URL(page.url()).search;
  await page.locator('#drill').click();
  await page.locator('#settings summary').click();
  await page.locator('#players button').last().click();
  await page.locator('#cak').click();
  const setupLink = page.url();
  await reloadInBrowser(page);
  assert.equal(await page.locator('#drill').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#start-drill').count(), 1, 'refresh stays on the table-selection screen');
  assert.equal(new URL(page.url()).searchParams.get('players'), '6');
  const other = await open(t, { width: 390, height: 844 }, new URL(setupLink).search);
  assert.equal(await other.locator('#start-drill').count(), 1, 'a setup link opens setup');
  await other.locator('#practice').click();
  assert.equal(new URL(other.url()).searchParams.get('players'), '6', 'a fresh tab cannot restore another tab\'s old table');
  assert.equal(await other.locator('.piece.me, .piece.opp').count(), 0);
  await page.locator('#practice').click();
  assert.equal(new URL(page.url()).search, before);
  await reloadInBrowser(page);
  await page.locator('#drill').click();
  await page.locator('#practice').click();
  assert.equal(new URL(page.url()).search, before, 'later drill visits use the current board as their return point');
});

test('blank and partially entered boards do not offer settlement advice', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.locator('#custom').click();
  await page.locator('#blank-board').click();
  const advice = '.best-card, .pick-card, .verdict, [data-disclosure="draft"], #svg .best-ring, #svg .road, #preview-best';
  assert.equal(await page.locator(advice).count(), 0, 'a blank board has no invented best corners or projections');
  assert.match(await page.locator('#panel').innerText(), /finish entering/i);
  await page.locator('#tool-wheat').click();
  await page.locator('.hex').first().press('Enter');
  await page.locator('#tool-number').click();
  await page.locator('.hex').first().press('Enter');
  await page.locator('.picker button[data-num="6"]').click();
  await page.locator('#tool-number').click();
  assert.equal(await page.locator(advice).count(), 0, 'one producing tile is still an incomplete board');
  assert.equal(await page.locator('.vx.legal').count(), 0, 'incomplete land cannot be committed as a graded settlement');
});

test('rapid keyboard entry of the larger board stays responsive and shareable without a connection', async t => {
  const { generateBoard, decodeBoard } = await import('../public/board.js');
  const original = generateBoard({ setup: 'ext56', seed: 42, balanced: true });
  const page = await open(t, { width: 390, height: 900 }, '?players=6&seed=42&seat=1');
  await page.context().setOffline(true);
  await page.locator('#custom').click();
  await page.locator('#blank-board').click();
  for (const hex of original.hexes) {
    const tool = page.locator('#tool-' + hex.resource);
    if (await tool.getAttribute('aria-pressed') !== 'true') await tool.click();
    await page.locator(`.hex[data-hex="${hex.id}"]`).focus();
    await page.keyboard.press('Enter');
  }
  await page.locator('#tool-number').click();
  for (const hex of original.hexes.filter(h => h.number)) {
    await page.locator(`.hex[data-hex="${hex.id}"]`).focus();
    await page.keyboard.press('Enter');
    await page.locator(`[data-num="${hex.number}"]`).click();
  }
  assert.equal(await page.locator('#port-mode').count(), 1, 'the last number must render the harbour decision');
  assert.equal(await page.locator('#preview-best').count(), 0, 'unresolved harbours still withhold advice');
  await page.locator('#port-mode').click();
  await page.locator('#tool-number').click();
  const query = new URL(page.url()).searchParams;
  const decoded = decodeBoard('ext56', query.get('b'), query.get('h'));
  assert.deepEqual(decoded.hexes.map(h => [h.resource, h.number]), original.hexes.map(h => [h.resource, h.number]));
  assert.equal(query.get('ports'), 'ignore');
  await page.locator('#preview-best').click();
  await page.locator('#keep').click();
  await page.locator('#preview-best').click();
  await page.locator('#keep').click();
  assert.match(await page.locator('.opening-card').innerText(), /expected cards/);
});

test('refused address updates keep edits usable, copy the current board and recover on explicit retry', async t => {
  const { decodeBoard } = await import('../public/board.js');
  const page = await open(t, { width: 390, height: 900 });
  await page.locator('#custom').click();
  const original = page.url();
  const resource = (await page.locator('.hex[data-hex="0"]').getAttribute('class')).includes('wood') ? 'ore' : 'wood';
  await page.evaluate(() => {
    const replace = history.replaceState.bind(history);
    window.refuseHistory = true; window.historyAttempts = 0;
    history.replaceState = (...args) => {
      window.historyAttempts++;
      if (window.refuseHistory) throw new DOMException('Simulated browser history limit', 'SecurityError');
      return replace(...args);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedBoard = text; } } });
  });
  await page.locator('#tool-' + resource).click();
  await page.locator('.hex[data-hex="0"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(page.url(), original, 'the browser refused the address change');
  assert.equal(await page.locator('#history-warning').count(), 1);
  assert.match(await page.locator('#history-warning').innerText(), /address.*behind|latest edits/i);
  assert.ok((await page.locator('.hex[data-hex="0"]').getAttribute('class')).includes(resource));
  const attempts = await page.evaluate(() => window.historyAttempts);
  await page.locator('#share').click();
  const copied = await page.evaluate(() => window.copiedBoard);
  const query = new URL(copied).searchParams;
  assert.equal(decodeBoard('base', query.get('b'), query.get('h')).hexes[0].resource, resource);
  assert.notEqual(copied, original);
  const help = new URL(await page.getByRole('link', { name: 'How it works', exact: true }).getAttribute('href'), page.url());
  assert.equal(help.search, new URL(copied).search, 'help also carries the latest board');
  assert.equal(await page.evaluate(() => window.historyAttempts), attempts, 'copying never retries a refused history write');
  await page.evaluate(() => { window.refuseHistory = false; });
  await page.locator('#retry-url').click();
  assert.equal(page.url(), copied);
  assert.equal(await page.locator('#history-warning').count(), 0);
  assert.equal(await page.locator('#share').evaluate(el => el === document.activeElement), true);
  await reloadInBrowser(page);
  assert.ok((await page.locator('.hex[data-hex="0"]').getAttribute('class')).includes(resource));
});

test('a refused recovery checkpoint leaves the existing board and pieces intact', async t => {
  for (const action of ['clear', 'new', 'players', 'seed', 'balanced', 'blank', 'random', 'explore']) {
    const page = await open(t, { width: 1400, height: 900 }, '?seed=42&players=4&seat=1&me=43&opp=0&seq=m43,o0');
    if (['blank', 'random', 'explore'].includes(action)) await page.locator('#custom').click();
    const original = page.url();
    await page.evaluate(() => { history.pushState = () => { throw new DOMException('Simulated recovery limit', 'SecurityError'); }; });
    if (['players', 'seed', 'balanced'].includes(action)) await page.locator('#settings summary').click();
    if (action === 'seed') { await page.locator('#seed').fill('77'); await page.locator('#seed').press('Tab'); }
    else if (action === 'players') await page.locator('#players button').filter({ hasText: '6' }).click();
    else await page.locator(({ clear: '#reset', blank: '#blank-board', random: '#rand-board', explore: '#practice', balanced: '#balanced', new: '#new' })[action]).click();
    assert.equal(page.url(), original, action);
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2, action);
    assert.equal(await page.locator('#history-warning').count(), 1, action);
    assert.match(await page.locator('#history-warning').innerText(), /not applied/i);
    if (action === 'seed') assert.equal(await page.locator('#seed').inputValue(), '42');
    await page.close();
  }
});

test('refused Drill history writes leave the mode unchanged and preserve the return board', async t => {
  const page = await open(t, { width: 390, height: 900 }, '?seed=42&players=4&seat=1&me=43&opp=0&seq=m43,o0');
  const original = page.url();
  await page.evaluate(() => {
    const replace = history.replaceState.bind(history);
    window.refuseHistory = true;
    history.replaceState = (...args) => {
      if (window.refuseHistory) throw new DOMException('Simulated history limit', 'SecurityError');
      return replace(...args);
    };
  });
  await page.locator('#drill').click();
  assert.equal(page.url(), original);
  assert.equal(await page.locator('#history-warning').count(), 1);
  assert.equal(await page.locator('#drill').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => { window.refuseHistory = false; });
  await page.locator('#drill').click();
  assert.equal(await page.locator('#start-drill').count(), 1);
  const drillURL = page.url();
  await page.evaluate(() => { window.refuseHistory = true; });
  await page.locator('#drill').click();
  assert.equal(page.url(), drillURL);
  assert.equal(await page.locator('#history-warning').count(), 1);
  assert.equal(await page.locator('#drill').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => { window.refuseHistory = false; });
  await page.locator('#drill').click();
  assert.equal(page.url(), original);
  assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2);
});

test('offline recovery restores both board layouts and ordered pieces inside the already-open page', async t => {
  for (const [from, to, count] of [[4, 6, 30], [6, 4, 19]]) {
    const page = await open(t, { width: 390, height: 900 }, `?players=${from}&seed=42&seat=1`);
    await page.locator('.vx.legal').first().click(); await page.locator('#keep').click();
    await page.locator('#mode-opp').click(); await page.locator('.vx.legal').first().click();
    await page.locator('#custom').click(); await page.locator('#port-mode').click();
    const original = page.url();
    await page.evaluate(() => { window.sameDocument = true; });
    const requests = []; page.on('request', r => requests.push(r.url()));
    await page.context().setOffline(true);
    await page.locator('#settings summary').click();
    await page.locator('#players button').filter({ hasText: String(to) }).click();
    const replacement = page.url();
    assert.equal(await page.locator('.hex.blank').count(), count);
    await page.locator('#restore-board').click();
    await page.waitForFunction(url => location.href === url && document.querySelectorAll('.piece.me, .piece.opp').length === 2, original, { timeout: 2500 });
    assert.equal(await page.locator('#port-mode').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => history.forward());
    await page.waitForFunction(({ url, count }) => location.href === url && document.querySelectorAll('.hex.blank').length === count, { url: replacement, count }, { timeout: 2500 });
    await page.evaluate(() => history.back());
    await page.waitForFunction(url => location.href === url && document.querySelectorAll('.piece.me, .piece.opp').length === 2, original, { timeout: 2500 });
    await page.locator('#undo').click();
    assert.equal(await page.locator('.piece.me').count(), 1);
    assert.equal(await page.locator('.piece.opp').count(), 0, 'Undo still follows the restored placement order');
    assert.equal(await page.evaluate(() => window.sameDocument), true);
    assert.deepEqual(requests, [], 'history recovery needs no navigation or resource fetch');
    await page.close();
  }
});

test('history navigation retains unsaved Drill progress and reloads the correct return snapshot without a connection', async t => {
  const { stageFor, setupStage } = await import('../public/drill.js');
  const page = await open(t, { width: 1400, height: 900 }, '?players=4&seed=42&seat=1&me=43&opp=0&seq=m43,o0');
  await page.locator('#custom').click(); const original = page.url();
  await page.locator('#reset').click(); const cleared = page.url();
  await page.evaluate(() => {
    window.sameDocument = true; window.allowProgressWrites = false;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'catan-lens.levels' && !window.allowProgressWrites) throw new DOMException('Simulated blocked save', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  const requests = []; page.on('request', r => requests.push(r.url()));
  await page.context().setOffline(true);
  await page.locator('#drill').click(); await page.locator('#start-drill').click();
  const drill = page.url(), seed = Number(new URL(drill).searchParams.get('seed'));
  const best = setupStage(stageFor(1), seed).ranking[0].id;
  await page.locator(`.vx[aria-label="Corner ${best}"]`).click(); await page.locator('#keep').click();
  assert.equal(await page.locator('.progress-warning').count(), 1);
  await page.evaluate(() => history.back());
  await page.waitForFunction(url => location.href === url && document.querySelectorAll('.piece.me, .piece.opp').length === 2, original, { timeout: 2500 });
  assert.equal(await page.locator('#drill').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => history.forward());
  await page.waitForFunction(url => location.href === url && document.querySelector('.track [data-level="1"].cleared'), drill, { timeout: 2500 });
  assert.equal(await page.locator('.progress-warning').count(), 1, 'the unsaved action remains available for retry');
  assert.equal(await page.locator('#drill-result, .best-ring, #preview-best').count(), 0, 'returning to a shared exercise does not reveal its answer');
  await page.evaluate(() => { window.allowProgressWrites = true; });
  await page.locator('#retry-progress').click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('catan-lens.levels'))), { ladders: { '4-base': [1] } });
  await page.locator('#drill').click();
  assert.equal(page.url(), cleared);
  assert.equal(await page.locator('.piece.me, .piece.opp').count(), 0);
  assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.sameDocument), true);
  assert.deepEqual(requests, []);
});

test('Drill difficulty notices follow the actual seed through links, refresh and bounded search without revealing answers', async t => {
  const { setupStage, stageFor } = await import('../public/drill.js');
  const page = await open(t, { width: 390, height: 900 });
  await page.evaluate(() => localStorage.setItem('catan-lens.levels', JSON.stringify({ ladders: { '4-base': Array.from({ length: 14 }, (_, i) => i + 1) } })));
  await page.addInitScript(() => { Math.random = () => 74.5 / 0xffffffff; });
  for (const seed of ['&seed=74', '']) {
    await page.goto(base + '?players=4&drill=1&level=15' + seed, { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).searchParams.get('seed'), '74');
    assert.match(await page.locator('#difficulty-note').innerText(), /outside.*usual difficulty band/i);
    assert.doesNotMatch(await page.locator('#difficulty-note').innerText(), /this one is close|3\.02|corner \d/i);
    assert.equal(await page.locator('.best-ring, #preview-best, [data-disclosure="draft"], .opening-preview').count(), 0);
    await reloadInBrowser(page);
    assert.equal(await page.locator('#difficulty-note').count(), 1);
  }
  for (const seed of [1, 157]) {
    await page.goto(base + '?players=4&drill=1&level=15&seed=' + seed, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#difficulty-note').count(), 0, 'a fitting seed, including the exact boundary, clears the notice');
  }
  await page.locator('.track button[data-level="15"]').click();
  assert.equal(await page.locator('#difficulty-note').count(), 1, 'exhausting the search uses the same honest notice');
  const best = setupStage(stageFor(15), 74).ranking[0].id;
  await page.locator(`.vx[aria-label="Corner ${best}"]`).focus();
  await page.keyboard.press('Enter'); await page.locator('#keep').click();
  assert.match(await page.locator('#drill-result').innerText(), /Level cleared/, 'the pass rule is unchanged');
  await page.locator('#drill').click();
  assert.equal(await page.locator('#difficulty-note').count(), 0);
  await page.goto(base + '?players=4&drill=1&level=10&seed=74', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#difficulty-note').count(), 0, 'an unconstrained stage needs no warning');
});

test('phone blank-board entry keeps its first tile visible alongside the tools', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.locator('#custom').tap();
  await page.locator('#blank-board').tap();
  const first = await page.locator('.hex').first().boundingBox();
  assert.ok(first.y >= 0 && first.y + first.height <= 844, 'the first tile must not be buried below the inventory checklist');
  assert.equal(await page.locator('.check').isVisible(), false, 'detailed inventory warnings start collapsed');
  await page.locator('[data-disclosure="inventory"] summary').tap();
  assert.equal(await page.locator('.check').isVisible(), true);
  assert.match(await page.locator('.check').innerText(), /wood: 0 hexes entered, the box has 4/);
});

test('changing board size starts the correct blank layout and preserves the old board across reload and navigation', async t => {
  for (const [from, to, count] of [[4, 6, 30], [6, 4, 19]]) {
    const page = await open(t, { width: 1400, height: 900 }, `?seed=42&players=${from}`);
    await page.locator('.vx.legal').first().click();
    await page.locator('#keep').click();
    await page.locator('#mode-opp').click();
    await page.locator('.vx.legal').first().click();
    await page.locator('#custom').click();
    const original = page.url();
    await page.locator('#settings summary').click();
    await page.locator('#players button').filter({ hasText: String(to) }).click();
    assert.equal(await page.locator('.hex.blank').count(), count, 'tile and edge IDs from another shape must never be reused');
    assert.equal(await page.locator('.harbor').count(), 0);
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 0);
    assert.equal(await page.locator('#restore-board').count(), 1, 'the previous board has a visible recovery action');
    const changed = page.url();
    await reloadInBrowser(page);
    assert.equal(await page.locator('.hex.blank').count(), count);
    await navigateHistory(page, () => page.locator('#restore-board').click());
    assert.equal(page.url(), original);
    assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.hex').count(), from === 4 ? 19 : 30);
    assert.equal(await page.locator('.piece.me').count(), 1);
    assert.equal(await page.locator('.piece.opp').count(), 1);
    assert.equal(await page.locator('.harbor').count(), from === 4 ? 9 : 11);
    await moveInBrowserHistory(page, 1);
    assert.equal(page.url(), changed, 'browser Forward restores the new board');
    assert.equal(await page.locator('.hex.blank').count(), count);
    await moveInBrowserHistory(page, -1);
    assert.equal(page.url(), original, 'browser Back restores the original board');
    assert.equal(await page.locator('.piece.me, .piece.opp').count(), 2);
    await page.close();
  }
});

test('replacing an entered board or leaving its editor can be undone after a refresh', async t => {
  for (const action of ['#blank-board', '#rand-board', '#new', '#practice']) {
    const page = await open(t, { width: 1400, height: 900 });
    await page.locator('.vx.legal').first().click();
    await page.locator('#keep').click();
    await page.locator('#custom').click();
    await page.locator('#tool-wheat').click();
    await page.locator('.hex').first().click();
    const original = page.url();
    await page.locator(action).click();
    assert.equal(await page.locator('#restore-board').count(), 1, `${action} keeps a recovery action`);
    assert.equal(await page.locator('.piece.me').count(), 0, 'settlements on the previous board must not move onto its replacement');
    await reloadInBrowser(page);
    await navigateHistory(page, () => page.locator('#restore-board').click());
    assert.equal(page.url(), original);
    assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.hex').first().getAttribute('class'), /wheat/);
    assert.equal(await page.locator('.piece.me').count(), 1);
    await page.close();
  }
});

test('changing player count within a board shape keeps entered tiles, harbours and pieces', async t => {
  for (const [from, to] of [[4, 3], [6, 5]]) {
    const page = await open(t, { width: 1400, height: 900 }, `?seed=42&players=${from}`);
    await page.locator('.vx.legal').first().click();
    await page.locator('#keep').click();
    await page.locator('#custom').click();
    const original = new URL(page.url()).searchParams;
    await page.locator('#settings summary').click();
    await page.locator('#players button').filter({ hasText: String(to) }).click();
    const after = new URL(page.url()).searchParams;
    for (const key of ['b', 'h', 'me', 'seq']) assert.equal(after.get(key), original.get(key), `${key} survives a same-shape table change`);
    assert.equal(await page.locator('.piece.me').count(), 1);
    await page.close();
  }
});

test('malformed board links keep their original data and show no advice until an explicit restart', async t => {
  const board = await import('../public/board.js');
  const encoded = board.encodeBoard(board.generateBoard({ seed: 42 }));
  const duplicate = encoded.h + ',' + encoded.h.split(',')[0].replace(/:./, ':o');
  const fixtures = [
    { b: 'zzz', h: '1:q' },
    { b: encoded.b.match(/[wbhsod-]\d{0,2}/g).slice(0, -1).join(''), h: encoded.h },
    { b: encoded.b, h: '9999:w' },
    { h: encoded.h },
    { b: encoded.b.replace('d', 'd8'), h: encoded.h },
    { b: encoded.b, h: duplicate },
  ];
  for (const fixture of fixtures) {
    const query = '?' + new URLSearchParams({ players: 4, ...fixture });
    const page = await open(t, { width: 1400, height: 900 }, query);
    assert.equal(new URL(page.url()).search, query, 'the unreadable link must not be replaced with unrelated board data');
    assert.equal(await page.locator('.link-error').count(), 1);
    assert.match(await page.locator('.link-error').innerText(), /Board link could not be read/);
    assert.equal(await page.locator('.best-ring, .best-card, .verdict, .road, .draft-details, .vx.legal').count(), 0);
    assert.equal(await page.locator('#showbest').isDisabled(), true);
    assert.equal(await page.locator('#players button:enabled').count(), 0, 'unreadable data cannot be reinterpreted by table controls');
    await reloadInBrowser(page);
    assert.equal(new URL(page.url()).search, query);
    await page.locator('#blank-board').click();
    assert.equal(await page.locator('.link-error').count(), 0);
    assert.equal(await page.locator('.hex.blank').count(), 19);
    assert.match(await page.locator('#restore-board').innerText(), /Restore original link/);
    await navigateHistory(page, () => page.locator('#restore-board').click());
    assert.equal(new URL(page.url()).search, query);
    assert.equal(await page.locator('.link-error').count(), 1);
    await page.locator('#rand-board').click();
    assert.equal(await page.locator('.link-error').count(), 0);
    assert.equal(await page.locator('.hex.blank').count(), 0);
    assert.ok(await page.locator('.best-ring').count() > 0);
    await page.close();
  }
});

test('a board linked with the wrong size can be opened at its matching table without changing its tiles or pieces', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  for (const [setup, wrongPlayers, rightPlayers] of [['base', 6, 4], ['ext56', 4, 5]]) {
    const encoded = encodeBoard(generateBoard({ setup, seed: 42 }));
    const query = '?' + new URLSearchParams({ players: wrongPlayers, seat: 1, b: encoded.b, h: encoded.h, me: 0, seq: 'm0' });
    const page = await open(t, { width: 390, height: 844 }, query);
    assert.equal(await page.locator('.link-error').count(), 1);
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator(`[data-recover-players="${rightPlayers}"]`).click()]);
    const after = new URL(page.url()).searchParams;
    assert.equal(after.get('players'), String(rightPlayers));
    assert.equal(after.get('b'), encoded.b);
    assert.equal(after.get('h'), encoded.h);
    assert.equal(after.get('me'), '0');
    assert.equal(after.get('seq'), 'm0');
    assert.equal(await page.locator('.link-error').count(), 0);
    assert.equal(await page.locator('.piece.me').count(), 1);
    assert.equal(await page.locator('.hex').count(), setup === 'base' ? 19 : 30);
    await page.close();
  }
});

test('valid unfinished board links remain editable without a link error', async t => {
  const query = '?' + new URLSearchParams({ players: 4, b: 'w' + '-'.repeat(18) });
  const page = await open(t, { width: 390, height: 844 }, query);
  assert.equal(await page.locator('.link-error').count(), 0);
  assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.best-ring, .verdict, .road').count(), 0);
  await page.locator('#tool-number').click();
  await page.locator('.hex').first().press('Enter');
  await page.locator('.picker button[data-num="6"]').click();
  assert.ok(new URL(page.url()).searchParams.get('b').startsWith('w6'));
});

test('leaving an unreadable link for Drill or Explore preserves the original error view and blind setting', async t => {
  const query = '?players=4&b=unreadable&best=0';
  const page = await open(t, { width: 1400, height: 900 }, query);
  await page.locator('#drill').click();
  await page.locator('#start-drill').click();
  assert.equal(await page.locator('.link-error, .best-ring, .verdict, .road').count(), 0);
  await page.locator('#practice').click();
  assert.equal(new URL(page.url()).search, query);
  assert.equal(await page.locator('.link-error').count(), 1);
  await page.locator('#practice').click();
  assert.equal(await page.locator('.link-error').count(), 0);
  assert.equal(await page.locator('#custom').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#showbest').getAttribute('aria-pressed'), 'false');
  await navigateHistory(page, () => page.locator('#restore-board').click());
  assert.equal(new URL(page.url()).search, query);
  assert.equal(await page.locator('.link-error').count(), 1);
});

test('missing harbours require a choice and every advice surface respects their exclusion without deleting entered ports', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const { rankSpots, scoreVertex, simulateDraft, suggestRoad } = await import('../public/score.js');
  const board = generateBoard({ seed: 129 });
  const withoutPorts = { ...board, harbors: {} };
  const settings = { players: 4, seat: 3, cak: false };
  const expected = rankSpots(withoutPorts, settings, { mine: [9], occupied: [9] });
  for (const harbors of [{}, Object.fromEntries(Object.entries(board.harbors).filter((_, i) => i % 2 === 0))]) {
    const encoded = encodeBoard({ ...board, harbors });
    const query = '?' + new URLSearchParams({ players: 4, seat: 3, ...encoded, me: 9, seq: 'm9' });
    const page = await open(t, { width: 1400, height: 900 }, query);
    assert.equal(await page.locator('.best-ring, .best-card, .verdict, .road, .draft-details').count(), 0, 'unknown harbours cannot silently count as absent');
    assert.equal(await page.locator('.piece.me').count(), 1);
    await page.locator('#port-mode').click();
    assert.equal(new URL(page.url()).searchParams.get('ports'), 'ignore');
    assert.equal(new URL(page.url()).searchParams.get('h') || '', encoded.h);
    assert.equal(await page.locator('.harbor').count(), Object.keys(harbors).length);
    assert.match(await page.locator('#harbor-status').innerText(), /excluded/);
    assert.equal(await page.locator('.best-ring').first().getAttribute('data-corner'), String(expected[0].id));
    assert.equal(await page.locator('.verdict .stat span').first().innerText(), 'Score ' + scoreVertex(withoutPorts, settings, 9).score.toFixed(2));
    const draft = simulateDraft(withoutPorts, settings, { me: [9], opp: [] }).filter(d => !d.actual).map(d => String(d.id));
    assert.deepEqual(await page.locator('.rank.draft li[data-id]:not([data-id=""])').evaluateAll(nodes => nodes.map(n => n.dataset.id)), draft);
    const road = suggestRoad(withoutPorts, settings, 9, { mine: [9], occupied: [9] });
    const edge = board.graph.edges[road.edge].v.map(id => board.graph.vertices[id]);
    for (const [key, value] of Object.entries({ x1: edge[0].x, y1: edge[0].y, x2: edge[1].x, y2: edge[1].y })) assert.equal(Number(await page.locator('#svg .road.me').getAttribute(key)), value);
    await reloadInBrowser(page);
    assert.equal(await page.locator('#port-mode').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.best-ring').first().getAttribute('data-corner'), String(expected[0].id));
    await page.locator('#port-mode').click();
    assert.equal(await page.locator('.best-ring, .verdict, .road, .draft-details').count(), 0, 'including unchecked partial harbours reopens the readiness decision');
    await page.close();
  }
});

test('a custom harbour inventory needs explicit confirmation, survives reload, and is checked again after a port edit', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const board = generateBoard({ seed: 42 });
  const [edge, type] = Object.entries(board.harbors)[0];
  const encoded = encodeBoard({ ...board, harbors: { [edge]: type } });
  const page = await open(t, { width: 390, height: 844 }, '?' + new URLSearchParams({ players: 4, ...encoded, me: 0, seq: 'm0' }));
  assert.equal(await page.locator('#confirm-harbors').count(), 1);
  await page.locator('#confirm-harbors').click();
  assert.equal(new URL(page.url()).searchParams.get('ports'), 'entered');
  assert.match(await page.locator('#harbor-status').innerText(), /custom|unmarked coast/i);
  assert.ok(await page.locator('.best-ring').count() > 0);
  await reloadInBrowser(page);
  assert.equal(await page.locator('#confirm-harbors').getAttribute('aria-pressed'), 'true');
  await page.locator('#tool-port').click();
  await page.locator(`.coast-hit[data-edge="${edge}"]`).press('Enter');
  assert.equal(new URL(page.url()).searchParams.has('ports'), false);
  assert.equal(await page.locator('.best-ring, .verdict, .road, .draft-details').count(), 0);
  assert.equal(await page.locator('.piece.me').count(), 1);
});

test('harbours sharing a corner must be repaired or excluded, with an accessible route to the conflicting edges', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const board = generateBoard({ seed: 42 });
  const first = Number(Object.keys(board.harbors)[0]);
  const shared = board.graph.perimeter.find(id => !board.harbors[id] && board.graph.edges[id].v.some(v => board.graph.edges[first].v.includes(v)));
  const encoded = encodeBoard({ ...board, harbors: { ...board.harbors, [shared]: 'ore' } });
  const page = await open(t, { width: 1400, height: 900 }, '?' + new URLSearchParams({ players: 4, ...encoded, ports: 'entered' }));
  assert.equal(await page.locator('.best-ring, .best-card').count(), 0, 'confirmation cannot override an unusable port layout');
  assert.equal(await page.locator('#confirm-harbors').count(), 0);
  assert.match(await page.locator('#harbor-status').innerText(), /share a corner/);
  await page.locator('#port-mode').click();
  assert.ok(await page.locator('.best-ring').count() > 0, 'land can be analysed with every harbour effect excluded');
  await page.locator('#port-mode').click();
  await page.locator('#review-ports').press('Enter');
  assert.equal(await page.locator('.coast-hit.conflict').count(), 2);
  assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /share.*corner/i);
  await page.locator(`.coast-hit[data-edge="${shared}"]`).press('Enter');
  assert.equal(await page.locator('.coast-hit.conflict').count(), 0);
  assert.ok(await page.locator('.best-ring').count() > 0, 'repairing the standard set restores advice');
});

test('excluding harbours respects blind practice and a new board resets the assumption', async t => {
  const { generateBoard, encodeBoard } = await import('../public/board.js');
  const encoded = encodeBoard(generateBoard({ seed: 42 }));
  const page = await open(t, { width: 1400, height: 900 }, '?' + new URLSearchParams({ players: 4, ...encoded, ports: 'ignore', best: 0 }));
  assert.equal(new URL(page.url()).searchParams.get('ports'), 'ignore');
  assert.equal(await page.locator('.best-ring, .best-card, .verdict, .road, .draft-details').count(), 0);
  assert.equal(await page.locator('#port-mode').getAttribute('aria-pressed'), 'true');
  await page.locator('#rand-board').click();
  assert.equal(new URL(page.url()).searchParams.has('ports'), false);
  assert.equal(await page.locator('#port-mode').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.best-ring, .best-card, .verdict, .road, .draft-details').count(), 0);
});

test('removing and restoring a number invalidates and restores all advice without losing pieces', async t => {
  for (const players of [4, 6]) {
    const page = await open(t, { width: 1400, height: 900 }, `?seed=42&players=${players}`);
    await page.locator('#custom').click();
    for (let i = 0; i < 2; i++) {
      await page.locator('#preview-best').click();
      await page.locator('#keep').click();
    }
    await page.locator('[data-disclosure="draft"] summary').click();
    assert.equal(await page.locator('.verdict').count(), 2);
    assert.equal(await page.getByRole('heading', { name: 'Your opening', exact: true }).count(), 1);
    const before = new URL(page.url()).search;
    await page.locator('#tool-number').click();
    await page.locator('.hex').first().press('Enter');
    assert.equal(await page.locator('.picker button[aria-pressed="true"]').getAttribute('data-num'), '8', 'seed 42 starts with token 8 for both layouts');
    await page.locator('.picker button[data-num="0"]').click();
    await page.locator('#tool-number').click();
    assert.equal(await page.locator('.best-card, .pick-card, .verdict, [data-disclosure="draft"], #svg .best-ring, #svg .road, #svg .badge').count(), 0, 'previous recommendations cannot remain on an incomplete board');
    assert.equal(await page.getByRole('heading', { name: 'Your opening', exact: true }).count(), 0);
    assert.equal(await page.locator('.piece.me').count(), 2, 'known placements are kept');
    assert.match(await page.locator('#panel').innerText(), /number token/i);
    await page.locator('#tool-number').click();
    await page.locator('.hex').first().press('Enter');
    await page.locator('.picker button[data-num="8"]').click();
    await page.locator('#tool-number').click();
    assert.equal(new URL(page.url()).search, before, 'repair restores the same board and ordered placements');
    assert.equal(await page.locator('.verdict').count(), 2);
    assert.equal(await page.getByRole('heading', { name: 'Your opening', exact: true }).count(), 1);
    await page.close();
  }
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

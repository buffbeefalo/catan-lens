// The installable app: the manifest and icons load, the offline copy takes control, and with the network
// cut a board link still opens (from the saved copy) and so does the help page. Automated browsers skip the
// offline copy by default (see index.html); this walkthrough turns it back on for its own pages.
const { BASE } = require('./helpers.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const page = await context.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const board = BASE + '?seed=42&players=4&seat=1';
  await page.goto(board, { waitUntil: 'networkidle' });

  // Manifest and icons: what a phone reads before offering "Install".
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const response = await fetch(link.href);
    const json = await response.json();
    const icons = await Promise.all(json.icons.map(async icon => {
      const url = new URL(icon.src, response.url).href;
      const image = new Image(); image.src = url; await image.decode();
      return { src: icon.src, sizes: icon.sizes, natural: `${image.naturalWidth}x${image.naturalHeight}` };
    }));
    return { type: response.headers.get('content-type'), name: json.name, display: json.display, icons };
  });
  assert.match(manifest.type, /manifest\+json|application\/json/);
  assert.equal(manifest.name, 'Catan Lens'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons.filter(i => i.sizes !== 'any')) assert.equal(icon.natural, icon.sizes, icon.src);

  // The offline copy installs and controls the page after a reload.
  const scope = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(r => r.scope),
    new Promise((_, fail) => setTimeout(() => fail(new Error('the offline copy did not install within 10 s')), 10000))]));
  assert.equal(scope, BASE, 'the offline copy covers exactly the app folder');
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the reloaded page is served through the offline copy');

  // Network cut: a different board link still opens and shows a playable board.
  await context.setOffline(true);
  await page.goto(BASE + '?seed=7&players=4&seat=2', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true', null, { timeout: 10000 });
  const offline = await page.evaluate(() => ({ hexes: document.querySelectorAll('#svg .hex').length, corners: document.querySelectorAll('#hits .vx.legal').length, panel: document.querySelector('#panel').innerText }));
  assert.equal(offline.hexes, 19, 'all 19 tiles drawn offline');
  assert.ok(offline.corners > 30, 'open corners are clickable offline');
  assert.match(offline.panel, /Best first settlement/);
  assert.doesNotMatch(offline.panel, /could not load/i);

  // The help page also opens offline.
  await page.goto(BASE + 'how-it-works.html', { waitUntil: 'load' });
  assert.match(await page.locator('h1').first().innerText(), /\S/);
  assert.equal(await page.locator('#install').count(), 1, 'the help page explains how to install');
  await context.setOffline(false);
  await browser.close();
  assert.deepEqual(errs, []);
  console.log('PWA E2E OK, zero page errors');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

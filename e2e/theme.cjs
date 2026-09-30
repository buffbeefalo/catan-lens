// Light and dark: the page follows the device until the header switch picks a theme, remembers the pick, applies it
// before the app script runs (no flash), and keeps the board's physical pieces (cream tokens, dark numbers) in both.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { BASE } = require('./helpers.cjs');

const LIGHT_BG = 'rgb(244, 239, 228)', DARK_BG = 'rgb(19, 27, 21)';
const look = page => page.evaluate(() => {
  const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
  return { theme: document.documentElement.dataset.theme || null, bg: css('body', 'backgroundColor'), text: css('body', 'color'),
    token: css('#svg .tok', 'fill'), number: css('#svg .tok-n:not(.red)', 'fill'), label: document.getElementById('theme').getAttribute('aria-label') };
});

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const url = BASE + '?seed=42&players=4&seat=1';

  // 1. A light device gets the light theme; the switch turns it dark and the pick survives a reload
  const light = await browser.newContext({ colorScheme: 'light', viewport: { width: 1400, height: 900 } });
  let page = await light.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  let s = await look(page);
  assert.equal(s.bg, LIGHT_BG); assert.equal(s.label, 'Switch to dark theme'); assert.equal(s.theme, null, 'no pick yet: follows the device');
  await page.click('#theme');
  s = await look(page);
  assert.equal(s.theme, 'dark'); assert.equal(s.bg, DARK_BG); assert.equal(s.label, 'Switch to light theme');
  assert.equal(s.token, 'rgb(247, 242, 230)', 'number tokens stay cream in the dark theme');
  assert.equal(s.number, 'rgb(29, 43, 31)', 'numbers stay dark on the cream token');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal((await look(page)).bg, DARK_BG, 'the pick survives a reload');
  console.log('light device: switch to dark, pick remembered');

  // 2. The saved pick is applied by the page head, before the app script runs: no flash of the other theme
  await page.route('**/app.js', r => r.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'head applies the pick without app.js');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), DARK_BG);
  await page.unroute('**/app.js');
  console.log('saved pick applied before the app loads');

  // 3. The How it works page shares the pick and has its own switch
  await page.goto(BASE + 'how-it-works.html', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), DARK_BG);
  await page.click('#theme');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), LIGHT_BG, 'switch on How it works');
  await page.goto(url, { waitUntil: 'networkidle' });
  assert.equal((await look(page)).bg, LIGHT_BG, 'the app follows a pick made on How it works');
  await light.close();
  console.log('How it works shares the pick');

  // 4. A dark device gets the dark theme with no pick stored, and the switch can still choose light
  const dark = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });
  page = await dark.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  s = await look(page);
  assert.equal(s.theme, null); assert.equal(s.bg, DARK_BG, 'dark device: dark theme by default'); assert.equal(s.label, 'Switch to light theme');
  assert.equal(s.number, 'rgb(29, 43, 31)');
  await page.click('#theme');
  assert.equal((await look(page)).bg, LIGHT_BG, 'a dark device can still pick light');
  await dark.close();
  console.log('dark device: dark by default, light on request');

  await browser.close();
  assert.deepEqual(errors, []);
  console.log('theme: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });

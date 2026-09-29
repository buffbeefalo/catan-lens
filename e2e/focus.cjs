const { showSettings, BASE } = require('./helpers.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '?seed=42&players=4&seat=1', { waitUntil: 'networkidle' });
  // keyboard-focus the first legal corner: Tab from the seed input lands on the first tabbable in the board
  await showSettings(page); await page.focus('#seed');
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement.tagName === 'circle')) break; }
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => { const a = document.activeElement; const g = getComputedStyle(a); const r = a.getBoundingClientRect(); return { tag: a.tagName, cls: a.getAttribute('class'), fv: a.matches(':focus-visible'), outline: g.outlineStyle, stroke: g.stroke, sw: g.strokeWidth, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
  console.log('focused', st);
  assert.equal(st.tag, 'circle'); assert.ok(st.fv, 'focus-visible');
  assert.equal(st.outline, 'none');
  assert.equal(st.stroke, 'rgb(29, 43, 31)');
  await page.screenshot({ path: 'focus-after.png', clip: { x: st.cx - 120, y: st.cy - 120, width: 240, height: 240 } });
  await page.keyboard.press('Enter'); await page.waitForTimeout(150);   // keyboard still places a pick
  assert.match(await page.$eval('#panel', el => el.innerText), /Your pick/);
  await browser.close();
  assert.deepEqual(errs, []);
  console.log('focus ring ok, keyboard pick ok');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

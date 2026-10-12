const playwright = require('playwright');

async function openDisclosure(page, selector) {
  const details = page.locator(selector);
  if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click();
}

// The app under test: the local static server by default (`npm start`), or any deployment via CATAN_URL.
const BASE = (process.env.CATAN_URL || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');

// The browser engine: CATAN_BROWSER=chromium (default), firefox or webkit. CHROMIUM_PATH picks a Chromium build.
// A typo must stop the run, never quietly test Chromium instead.
const ENGINE = process.env.CATAN_BROWSER || 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(ENGINE)) throw new Error(`Unknown CATAN_BROWSER "${ENGINE}": use chromium, firefox or webkit`);
const launch = () => playwright[ENGINE].launch({ headless: true, executablePath: ENGINE === 'chromium' && process.env.CHROMIUM_PATH || undefined });

async function navigateHistory(page, action) {
  const previous = page.url();
  await Promise.all([page.waitForURL(url => url.href !== previous), action()]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

module.exports = {
  BASE,
  ENGINE,
  launch,
  navigateHistory,
  showSettings: page => openDisclosure(page, '#settings'),
  showDraft: page => openDisclosure(page, '[data-disclosure="draft"]'),
};

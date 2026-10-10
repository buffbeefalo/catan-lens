async function openDisclosure(page, selector) {
  const details = page.locator(selector);
  if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click();
}

// The app under test: the local static server by default (`npm start`), or any deployment via CATAN_URL.
const BASE = (process.env.CATAN_URL || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');

async function navigateHistory(page, action) {
  const previous = page.url();
  await Promise.all([page.waitForURL(url => url.href !== previous), action()]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
}

module.exports = {
  BASE,
  navigateHistory,
  showSettings: page => openDisclosure(page, '#settings'),
  showDraft: page => openDisclosure(page, '[data-disclosure="draft"]'),
};

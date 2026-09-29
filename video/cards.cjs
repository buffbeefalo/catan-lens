// Renders the designed frames from cards.html: the backdrop behind the app window (2x, for zooming) and the
// title, results and end cards as 60 fps image sequences, stopping once a card no longer moves (render.py holds
// its last frame). Writes build/<id>/cards/backdrop.png and build/<id>/cards/<card>/NNNNN.png.
//   node video/cards.cjs [id ...]
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const FPS = 60;

(async () => {
  const { VIDEOS, SITE } = await import('./scenes.mjs');
  const want = process.argv.slice(2);
  const results = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'media', 'results.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const url = 'file://' + path.join(__dirname, 'cards.html');
  for (const v of VIDEOS.filter(v => !want.length || want.includes(v.id))) {
    const dir = path.join(__dirname, 'build', v.id, 'cards');
    fs.rmSync(dir, { recursive: true, force: true });
    const data = { intro: v.intro, outro: v.outro, site: SITE, results };
    const cards = ['intro', 'outro', ...(v.scenes.some(s => String(s.act).includes('showResults')) ? ['results'] : [])];
    const big = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    await big.goto(url);
    await big.evaluate(d => { window.__load(d, 'backdrop'); window.__seek(0); }, data);
    fs.mkdirSync(dir, { recursive: true });
    await big.screenshot({ path: path.join(dir, 'backdrop.png') });
    await big.close();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(url);
    const counts = {};
    for (const card of cards) {
      fs.mkdirSync(path.join(dir, card));
      await page.evaluate(([d, c]) => window.__load(d, c), [data, card]);
      let i = 0;
      for (;; i++) {
        const settled = await page.evaluate(t => window.__seek(t), i / FPS);
        await page.screenshot({ path: path.join(dir, card, `${String(i).padStart(5, '0')}.png`) });
        if (settled) break;
      }
      counts[card] = i + 1;
    }
    fs.writeFileSync(path.join(dir, 'cards.json'), JSON.stringify({ fps: FPS, frames: counts }));
    await page.close();
    console.log(`${v.id}: backdrop + ${Object.entries(counts).map(([k, n]) => `${k} ${n} frames`).join(', ')}`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

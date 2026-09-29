// Records each demo video from the live app. Needs the narration timings first (narrate.py), so each
// scene is held for at least as long as its narration. Writes build/<id>/raw.webm and cues.json (the
// second each scene starts, measured from the start of the recording).
//   node video/record.cjs [id ...]        (CATAN_URL defaults to the local server)
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { BASE } = require('../e2e/helpers.cjs');

const BUILD = path.join(__dirname, 'build');
const VIEW = { width: 1280, height: 720 };

// A visible cursor with a click pulse: headless recordings otherwise show no pointer at all.
const CURSOR = `addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;z-index:2147483647;pointer-events:none;transition:transform .12s;background:url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'22\\' height=\\'22\\'><path d=\\'M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10 13 L16 13 Z\\' fill=\\'#1d2b1f\\' stroke=\\'white\\' stroke-width=\\'1.5\\'/></svg>') + '") no-repeat';
  document.body.append(c);
  addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.8)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = ''; }, true);
});`;

function resultsPage(results) {
  const rows = results.arms.map(a => `<div class="row${a.key === 'lens' || a.key === 'lens-sett' ? ' lens' : ''}"><span class="lab">${a.label}</span><span class="bar" style="width:${a.win * 16}px"></span><b>${a.win.toFixed(1)}%</b><span class="ci">± ${a.ci.toFixed(1)}</span></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f4efe4;color:#1d2b1f;font-family:'Trebuchet MS','Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
    .wrap{width:1040px} h1{font-family:Georgia,serif;font-size:38px;margin:0 0 6px} p{color:#5b675c;font-size:18px;margin:0 0 28px}
    .row{display:flex;align-items:center;gap:16px;margin:12px 0;font-size:20px} .lab{width:380px;text-align:right}
    .bar{height:34px;background:#a6aab0;border-radius:6px} .lens .bar{background:#2f6b46} b{font-family:ui-monospace,Menlo,monospace} .ci{color:#5b675c;font-size:15px}
    .foot{margin-top:26px;font-size:15px}</style></head><body><div class="wrap">
    <h1>Win rate by opening strategy</h1><p>${results.games.toLocaleString('en-US')} complete four-player games per strategy in ${results.runs} independent runs · every seat played by Catanatron's value-function bot · a fair seat wins 25%</p>
    ${rows}<p class="foot">Only the opening differs. The rest of each game is played by the same bot.</p></div></body></html>`;
}

async function hold(page, until) { const ms = until - Date.now(); if (ms > 0) await page.waitForTimeout(ms); }

(async () => {
  const { VIDEOS, rankingFor } = await import('./scenes.mjs');
  const want = process.argv.slice(2);
  const results = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'media', 'results.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const v of VIDEOS.filter(v => !want.length || want.includes(v.id))) {
    const dir = path.join(BUILD, v.id);
    const timings = JSON.parse(fs.readFileSync(path.join(dir, 'timings.json'), 'utf8'));
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.webm')) fs.unlinkSync(path.join(dir, f));
    const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir, size: VIEW } });
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    const t0 = Date.now();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + v.url, { waitUntil: 'networkidle' });
    await page.mouse.move(VIEW.width * 0.62, VIEW.height * 0.55);
    const u = {
      wait: ms => page.waitForTimeout(ms),
      ranking: () => rankingFor(page.url()),
      async hover(sel) {
        const box = await page.locator(sel).first().boundingBox();
        if (!box) throw new Error(`${v.id}: nothing to point at for ${sel}`);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
        await page.waitForTimeout(250);
      },
      async click(sel) { await u.hover(sel); await page.waitForTimeout(150); await page.locator(sel).first().click({ force: true }); await page.waitForTimeout(350); },   // force: thin SVG lines (harbour edges) never pass the visibility check
      async showResults() { await page.waitForTimeout(600); await page.setContent(resultsPage(results)); },
    };
    const cues = [];
    for (const [i, s] of v.scenes.entries()) {
      const start = Date.now();
      cues.push((start - t0) / 1000);
      await s.act(u);
      await hold(page, start + timings[i].duration * 1000 + 350);
    }
    cues.push((Date.now() - t0) / 1000);   // end of the last scene
    await page.waitForTimeout(800);
    await context.close();
    const raw = fs.readdirSync(dir).find(f => f.endsWith('.webm'));
    fs.renameSync(path.join(dir, raw), path.join(dir, 'raw.webm'));
    fs.writeFileSync(path.join(dir, 'cues.json'), JSON.stringify(cues));
    if (errors.length) throw new Error(`${v.id}: page errors: ${errors.join('; ')}`);
    console.log(`${v.id}: ${v.scenes.length} scenes, ${cues.at(-1).toFixed(1)} s`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

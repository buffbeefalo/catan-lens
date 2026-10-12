// Look-ahead latency in a real browser: `node bench/lookahead-latency.cjs` against a running server (CATAN_URL,
// default http://127.0.0.1:8080/). For each table size it opens boards at the start of the draft and late in it,
// then times switching the ranking to Look-ahead (the full recompute and redraw, measured inside the page), with
// Chromium's CPU at full speed and throttled 4x. A 4x throttle on a desktop is a rough phone proxy, not a phone.
const { chromium } = require('playwright');
const BASE = (process.env.CATAN_URL || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');
(async () => {
  const { generateBoard } = await import('../public/board.js');
  const { simulateDraft } = await import('../public/score.js');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const cdp = await page.context().newCDPSession(page);
  console.log(`Chromium ${browser.version()}, ${require('node:os').cpus().length} logical CPUs (${require('node:os').cpus()[0].model.trim()})`);
  console.log('| Throttle | Players | Draft stage | Positions | Median ms | 90th pct ms | Max ms |\n|---|---|---|---|---|---|---|');
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const players of [3, 4, 5, 6]) for (const stage of ['first pick, nobody placed', 'last seat, all first picks placed']) {
      const times = [];
      for (let seed = 1; seed <= 6; seed++) {
        const seat = stage.startsWith('last') ? players : 1;
        let url = `${BASE}?players=${players}&seed=${seed}&seat=${seat}`;
        if (stage.startsWith('last')) {
          // Every earlier seat has placed its projected first settlement (the densest first-pick position).
          const board = generateBoard({ setup: players >= 5 ? 'ext56' : 'base', seed, balanced: true });
          const opp = simulateDraft(board, { players, seat, cak: false }).filter(d => d.round === 1 && d.seat < seat).map(d => d.id);
          url += `&opp=${opp.join(',')}&seq=${opp.map(id => 'o' + id).join(',')}`;
        }
        await page.goto(url, { waitUntil: 'networkidle' });
        times.push(await page.evaluate(() => {
          document.querySelector('#settings').open = true;
          const button = [...document.querySelectorAll('#policy button')].find(b => b.textContent === 'Look-ahead');
          const t = performance.now(); button.click(); return performance.now() - t;
        }));
      }
      times.sort((a, b) => a - b);
      const q = p => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(0);
      console.log(`| ${rate}x | ${players} | ${stage} | ${times.length} | ${q(0.5)} | ${q(0.9)} | ${q(1)} |`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

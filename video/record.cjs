// Records each demo video from the live app as a timeline, not a screen capture: every step saves a sharp
// 2x screenshot of the page, and the cursor path, clicks and camera moves are written down with their times.
// render.py then draws the frames (camera zooms, cursor, cards) from that. Needs the narration timings
// first (narrate.py), so each scene lasts at least as long as its narration.
// Writes build/<id>/states/*.png and build/<id>/timeline.json.
//   node video/record.cjs [id ...]        (CATAN_URL defaults to the local server)
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { BASE } = require('../e2e/helpers.cjs');

const BUILD = path.join(__dirname, 'build');
const VIEW = { width: 1536, height: 900 };
const DPR = 4;          // capture density: pixels stay sharp up to zoom DPR / 1.5
// Where the app window sits in the 1920x1080 frame at zoom 1 (render.py draws the same layout).
const LAYOUT = { out: [1920, 1080], content: [192, 109], bar: 38, radius: 14 };
const MARGIN = 0.05;    // anything framed or pointed at stays this far (share of the frame) from the edges
const ZOOM = 2.2;       // the tightest framing, unless text being read needs more
const READ_PX = 28;     // text the narration reads must be at least this many output pixels tall (font size)
const INTRO = 2.6;      // seconds of title card before the app appears
const LEAD = 0.35;      // narration starts this long after its scene
const TAIL = 0.55;      // and the scene holds this long after the narration ends
const OUTRO_MIN = 5.5;  // the end card stays up at least this long

// Words as narrate.py compares them: lower case, digits spelled out ("6" and "six" match), hyphens split.
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const spell = n => n < 20 ? ONES[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
  : n < 1000 ? ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + spell(n % 100) : '') : spell(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + spell(n % 1000) : '');
const norm = text => text.toLowerCase().replace(/’/g, "'").replace(/(\d),(\d)/g, '$1$2').replace(/\d+/g, d => ` ${spell(Number(d))} `)
  .replace(/-/g, ' ').replace(/[^a-z' ]/g, ' ').split(/\s+/).map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean);
const moveTime = (a, b) => Math.min(1.05, 0.42 + Math.hypot(b[0] - a[0], b[1] - a[1]) / 1800);

(async () => {
  const { VIDEOS, rankingFor } = await import('./scenes.mjs');
  const want = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const v of VIDEOS.filter(v => !want.length || want.includes(v.id))) {
    const dir = path.join(BUILD, v.id);
    const narration = JSON.parse(fs.readFileSync(path.join(dir, 'narration.json'), 'utf8'));
    fs.rmSync(path.join(dir, 'states'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'states'), { recursive: true });
    v.scenes.forEach((s, i) => { if (narration.scenes[i]?.text !== s.say) throw new Error(`${v.id}: narration for scene ${i} is out of date; rerun narrate.py`); });
    if (narration.outro.text !== v.outro.say) throw new Error(`${v.id}: outro narration is out of date; rerun narrate.py`);
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + v.url, { waitUntil: 'networkidle' });

    let T = INTRO - 0.5;                       // the app fades in under the end of the title card
    let cursor = [VIEW.width * 0.66, VIEW.height * 0.58];
    await page.mouse.move(...cursor);
    const tl = { title: v.title, viewport: VIEW, dpr: DPR, layout: LAYOUT, margin: MARGIN, states: [], moves: [], clicks: [], camera: [], scenes: [], segments: [] };
    let voice = 0, words = [];   // the current scene's narration start and word timings, for u.at
    const seen = new Map();
    async function snap(at) {
      await page.waitForTimeout(120);          // let hover styles and re-renders land
      if (await page.evaluate(() => scrollY) !== 0) throw new Error(`${v.id}: the page scrolled; frame a step that fits the window`);
      const buf = await page.screenshot({ type: 'png' });
      const key = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
      if (!seen.has(key)) { seen.set(key, `states/${key}.png`); fs.writeFileSync(path.join(dir, `states/${key}.png`), buf); }
      const file = seen.get(key);
      if (tl.states.at(-1)?.file !== file) tl.states.push({ t: +at.toFixed(3), file });
    }
    async function rectOf(sel) {
      if (sel === 'page') return [0, 0, VIEW.width, VIEW.height];
      const boxes = [];
      for (const s of [sel].flat()) {
        const b = await page.locator(s).first().boundingBox();
        if (!b) throw new Error(`${v.id}: nothing to frame for ${s}`);
        boxes.push([b.x, b.y, b.x + b.width, b.y + b.height]);
      }
      return [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
    }
    const u = {
      ranking: () => rankingFor(page.url()),
      async wait(ms) { T += ms / 1000; },
      // Waits until the narration reaches `phrase`, so the action lands on the word that describes it.
      async at(phrase) {
        const want = norm(phrase), toks = words.flatMap(w => norm(w.w).map(t => ({ t, start: w.start })));
        const k = toks.findIndex((_, i) => want.every((w, j) => toks[i + j]?.t === w));
        if (k < 0) throw new Error(`${v.id}: "${phrase}" is not in the narration`);
        T = Math.max(T, voice + toks[k].start - 0.2);
      },
      async expect(sel, text) {
        const got = await page.locator(sel).first().innerText();
        if (!got.includes(text)) throw new Error(`${v.id}: expected "${text}" in ${sel}, the page shows "${got.slice(0, 120)}"`);
      },
      async focus(sel, opts = {}) {
        const [x0, y0, x1, y1] = await rectOf(sel), [W, H] = LAYOUT.out, [ox, oy] = LAYOUT.content;
        let zoom = 1, cx = W / 2, cy = H / 2;
        if (sel !== 'page') {
          const fit = Math.min(W * (1 - 2 * MARGIN) / (x1 - x0), H * (1 - 2 * MARGIN) / (y1 - y0));
          zoom = Math.max(1, Math.min(opts.zoom || fit, fit, ZOOM));
          let font = null;
          if (opts.read) {
            font = await page.locator([sel].flat()[0]).first().evaluate(el => {
              let min = Infinity;
              for (const n of el.querySelectorAll('*')) if ([...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) && n.getClientRects().length) min = Math.min(min, parseFloat(getComputedStyle(n).fontSize));
              return min;
            });
            const need = Math.ceil(READ_PX / font * 1e4) / 1e4;
            if (need > Math.min(fit, DPR / 1.5)) throw new Error(`${v.id}: ${sel} cannot be read at ${READ_PX} px and still fit the frame (needs zoom ${need.toFixed(2)}, fits ${fit.toFixed(2)}); frame something smaller`);
            zoom = Math.max(zoom, need);
          }
          // zoomed in, the camera stays inside the app window rather than showing the backdrop beside it
          const keep = (c, half, lo, len) => (2 * half <= len ? Math.min(Math.max(c, lo + half), lo + len - half) : lo + len / 2);
          cx = keep(ox + (x0 + x1) / 2, W / 2 / zoom, ox, VIEW.width);
          cy = keep(oy + (y0 + y1) / 2, H / 2 / zoom, oy, VIEW.height);
          zoom = Math.floor(zoom * 1e4) / 1e4;
          tl.camera.push({ t: +T.toFixed(3), zoom, center: [+cx.toFixed(1), +cy.toFixed(1)], rect: [x0, y0, x1, y1].map(n => +n.toFixed(1)), font, what: [sel].flat().join(' + ') });
          return;
        }
        tl.camera.push({ t: +T.toFixed(3), zoom, center: [cx, cy], rect: [x0, y0, x1, y1], font: null, what: 'page' });
      },
      async hover(sel) {
        const target = page.locator(sel).first();
        await target.scrollIntoViewIfNeeded();
        const b = await target.boundingBox();
        if (!b) throw new Error(`${v.id}: nothing to point at for ${sel}`);
        const to = [b.x + b.width / 2, b.y + b.height / 2];
        const d = moveTime(cursor, to);
        tl.moves.push({ t0: +T.toFixed(3), t1: +(T + d).toFixed(3), from: cursor.map(n => +n.toFixed(1)), to: to.map(n => +n.toFixed(1)) });
        await page.mouse.move(...to);
        cursor = to; T += d;
        await snap(T - 0.06);
        T += 0.22;
      },
      async click(sel) {
        await u.hover(sel);
        const b = await page.locator(sel).first().boundingBox();
        tl.clicks.push({ t: +T.toFixed(3), at: cursor.map(n => +n.toFixed(1)), box: [b.x, b.y, b.x + b.width, b.y + b.height].map(n => +n.toFixed(1)), what: sel });
        await page.locator(sel).first().click({ force: true });   // force: thin SVG lines (harbour edges) never pass the visibility check
        await page.waitForTimeout(250);
        await snap(T + 0.07);
        T += 0.5;
      },
      async showResults() {
        tl.segments.find(s => s.kind === 'app').t1 = +(T + 0.5).toFixed(3);   // the app fades out under the chart
        tl.segments.push({ kind: 'card', card: 'results', t0: +T.toFixed(3) });
      },
    };
    await snap(0);
    tl.segments.push({ kind: 'card', card: 'intro', t0: 0, t1: INTRO }, { kind: 'app', t0: INTRO - 0.5 });
    for (const [i, s] of v.scenes.entries()) {
      const start = T;
      voice = start + LEAD; words = narration.scenes[i].words;
      await s.act(u);
      const n = narration.scenes[i];
      T = Math.max(T, start + LEAD + n.duration + TAIL);
      tl.scenes.push({ start: +start.toFixed(3), voice: +(start + LEAD).toFixed(3), end: +T.toFixed(3), chapter: s.chapter || null });
    }
    const appEnd = T;
    for (const seg of tl.segments) if (seg.t1 === undefined) seg.t1 = +appEnd.toFixed(3);
    const outroVoice = appEnd + 0.6;
    const end = Math.max(appEnd + OUTRO_MIN, outroVoice + narration.outro.duration + 1.8);
    tl.segments.push({ kind: 'card', card: 'outro', t0: +appEnd.toFixed(3), t1: +end.toFixed(3) });
    tl.outro = { voice: +outroVoice.toFixed(3) };
    tl.duration = +end.toFixed(3);
    await context.close();
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(tl, null, 1));
    if (errors.length) throw new Error(`${v.id}: page errors: ${errors.join('; ')}`);
    console.log(`${v.id}: ${v.scenes.length} scenes, ${seen.size} distinct screens, ${tl.moves.length} moves, ${tl.clicks.length} clicks, ${end.toFixed(1)} s`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

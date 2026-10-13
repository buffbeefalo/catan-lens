// Layout walkthrough: single-column widths (Fold open, Fold closed, tablet) put the drill setup card and the
// Your board tools ABOVE the board; desktop keeps them in the right column. Also prints the measurements.
const assert = require('node:assert');
const { BASE, ENGINE, launch } = require('./helpers.cjs');
// Playwright's Firefox cannot emulate a phone's viewport handling (isMobile), so there the narrow sizes get
// the same widths and touch only; the result line says so.
const mobile = ENGINE !== 'firefox';
(async () => {
  const browser = await launch();
  const errors = [];
  const rect = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }; });
  for (const [name, w, h, single] of [['fold-open', 904, 1800, true], ['fold-closed', 390, 900, true], ['tablet', 1000, 900, true], ['desktop', 1400, 900, false]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: single, isMobile: single && mobile });
    page.on('pageerror', e => errors.push(name + ': ' + e.message));
    await page.goto(BASE + '?players=4&seed=7', { waitUntil: 'networkidle' });
    const m = await page.evaluate(() => ({ boardW: Math.round(document.querySelector('#svg').getBoundingClientRect().width), cols: getComputedStyle(document.querySelector('.wrap')).gridTemplateColumns, docW: document.documentElement.scrollWidth, vw: innerWidth }));
    console.log(name, w + 'x' + h, JSON.stringify(m));
    assert.ok(m.docW <= m.vw, `${name}: no horizontal page scroll`);
    if (single) {   // touch screens: every visible button and disclosure row is at least a 44 px tap target
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      const small = await page.$$eval('button, summary, .btn', els => els.filter(e => e.offsetParent).map(e => ({ e: e.id || e.textContent.trim().slice(0, 24), r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 0 && (r.height < 44 || r.width < 44)).map(({ e, r }) => `${e} ${Math.round(r.width)}x${Math.round(r.height)}`));
      if (coarse) assert.deepEqual(small, [], `${name}: every button and disclosure row is a 44 px tap target`);
      else console.log(`${name}: ${ENGINE} reports no touch pointer here, so tap sizes are not checked`);
    }
    // free play: no lead card, the board comes first in the column
    assert.equal(await page.$('.card.lead'), null, `${name}: free play has no lead card`);
    // drill setup card
    await page.click('#drill');
    let board = await rect(page, '.board'), lead = await rect(page, '.card.lead');
    assert.match(await page.$eval('.card.lead', el => el.innerText), /set your table first/);
    if (single) { assert.ok(lead.top + lead.height <= board.top, `${name}: drill setup card sits above the board (card bottom ${lead.top + lead.height}, board top ${board.top})`); assert.ok(await page.$eval('#start-drill', b => b.getBoundingClientRect().top < innerHeight), `${name}: Start button visible without scrolling`); }
    else assert.ok(lead.left > board.left + board.width - 1 && lead.top >= board.top - 1, `${name}: drill setup card stays in the right column`);
    await page.screenshot({ path: `${name}-setup.png` });
    await page.click('#drill');   // back to free play
    // Your board tools
    await page.click('#custom');
    board = await rect(page, '.board'); lead = await rect(page, '.card.lead');
    assert.match(await page.$eval('.card.lead', el => el.innerText), /Your board/);
    if (single) assert.ok(lead.top + lead.height <= board.top, `${name}: Your board tools sit above the board`);
    else assert.ok(lead.left > board.left + board.width - 1, `${name}: Your board tools stay in the right column`);
    // the panel's other cards still follow the board, in order
    const firstAfter = await page.$$eval('.wrap > *, .panel > .card', els => { const b = document.querySelector('.board').getBoundingClientRect().top; return [...document.querySelectorAll('.panel > .card')].filter(c => !c.classList.contains('lead')).every(c => c.getBoundingClientRect().top >= b); });
    assert.ok(firstAfter, `${name}: the remaining cards never jump above the board`);
    await page.screenshot({ path: `${name}-custom.png` });
    await page.close();
  }
  await browser.close();
  assert.deepEqual(errors, []);
  console.log('FOLD E2E OK, zero page errors' + (mobile ? '' : ` (${ENGINE}: phone widths without mobile viewport emulation)`));
})();

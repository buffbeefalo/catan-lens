// The look-ahead ranking (experimental) and plan choice in the page: the ring, the Best card, the projected rows and
// the road hint agree; links round-trip; old and hostile links stay classic; Drill locks both controls; blind practice
// still reveals nothing before a commit.
const { BASE, launch, showSettings, showDraft } = require('./helpers.cjs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pressed = sel => page.locator(`${sel} button[aria-pressed="true"]`).innerText();
  const ring = () => page.locator('.best-ring').evaluateAll(xs => xs.map(x => Number(x.dataset.corner)));
  const query = () => new URL(page.url()).searchParams;
  // Seed 3, seat 4 of 4, seats 1 to 3 already placed: the classic top corner (41) is not the best opening.
  const last = BASE + '?players=4&seed=3&seat=4&opp=43,3,20&seq=o43,o3,o20';

  // An old link (no policy or plan) is classic and by seat.
  await page.goto(last, { waitUntil: 'networkidle' });
  await showSettings(page);
  assert.equal(await pressed('#policy'), 'Classic');
  assert.equal(await pressed('#plan'), 'By seat');
  assert.deepEqual(await ring(), [41]);
  assert.equal(await page.locator('.lookahead-note').count(), 0, 'no look-ahead note in classic mode');
  assert.equal(query().has('policy'), false);

  // Look-ahead: the ring, the card, the stats and the projection all name the same opening.
  const started = Date.now();
  await page.locator('#policy button', { hasText: 'Look-ahead' }).click();
  assert.equal(query().get('policy'), 'draft');
  assert.deepEqual(await ring(), [33]);
  const card = page.locator('.best-card');
  assert.match(await card.innerText(), /Then your second settlement: /);
  assert.match(await card.locator('.stat').innerText(), /Opening value\s*28\.07[\s\S]*This corner\s*11\.93[\s\S]*Second pick\s*16\.14/);
  assert.ok(await card.locator('[data-disclosure="best"]').evaluate(el => el.open), 'Why this corner? starts open');
  assert.match(await card.innerText(), /Second settlement: the projected draft leaves you/);
  assert.match(await card.locator('.lookahead-note').innerText(), /The projection assumes every seat that has not placed picks by this model/);
  assert.doesNotMatch(await card.locator('.lookahead-note').innerText(), /not placed yet/, 'seats 1 to 3 are marked');
  assert.match(await card.locator('.road').innerText(), /^Road: point it toward/);
  await showDraft(page);
  // Opening the projection redraws the badges from its toggle event, which lands just after the click.
  await page.waitForFunction(() => document.querySelectorAll('#marks .badge.you').length === 2, null, { timeout: 5000 });
  const you = await page.locator('.rank.draft li.you').allInnerTexts();
  const desc = id => page.locator(`#hits .vx[aria-label="Corner ${id}"]`).getAttribute('aria-description');
  assert.equal(you.length, 2);
  assert.ok(you[0].includes(await desc(33)) && you[1].includes(await desc(41)), 'the You rows are the recommendation, then its second pick');
  assert.equal(await page.locator('#marks .badge.you').count(), 2);
  console.log(`look-ahead switch rendered in ${Date.now() - started} ms (4 players)`);

  // The link round-trips.
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await ring(), [33]);
  await showSettings(page);
  assert.equal(await pressed('#policy'), 'Look-ahead');

  // Previewing the classic favourite grades it against the look-ahead ranking and says why it trails.
  await page.locator('#hits .vx[aria-label="Corner 41"]').press('Enter');
  const pick = page.locator('.pick-card');
  assert.match(await pick.locator('h2').innerText(), /#\d+ of \d+/);
  assert.match(await pick.innerText(), /Second-settlement outlook: \d+\.\d\d for #1 versus \d+\.\d\d for your pick\./);
  await page.locator('#cancel-pick').click();

  // A plan for your own seat: link, note and summary; Cities & Knights keeps its own weighting.
  await page.locator('#plan button', { hasText: 'Roads' }).click();
  assert.equal(query().get('plan'), 'road');
  assert.match(await page.locator('#plan-note').innerText(), /Road-builder plan \(your choice\)/);
  assert.match(await page.locator('#table-summary').innerText(), /Roads plan · Look-ahead$/);
  await page.locator('#cak').click();
  assert.ok(await page.locator('#plan button').evaluateAll(xs => xs.every(x => x.disabled)), 'plan choice is off under Cities & Knights');
  assert.match(await page.locator('#plan-note').innerText(), /Cities & Knights plan/);
  await page.locator('#cak').click();
  await page.locator('#plan button', { hasText: 'By seat' }).click();
  assert.equal(query().has('plan'), false);

  // Hostile values fall back to the defaults.
  await page.goto(BASE + '?players=4&seed=3&policy=evil&plan=%3Cb%3E', { waitUntil: 'networkidle' });
  await showSettings(page);
  assert.equal(await pressed('#policy'), 'Classic');
  assert.equal(await pressed('#plan'), 'By seat');

  // A late seat with nobody marked: the advice says what it assumes about the seats before it.
  await page.goto(BASE + '?players=4&seed=3&seat=3&policy=draft', { waitUntil: 'networkidle' });
  assert.match(await page.locator('.best-card .lookahead-note').innerText(), /^Seats 1 and 2 have not placed yet, so this counts your settlement as placed now/);

  // Drill ranks with the classic policy and locks both controls; leaving it restores the look-ahead.
  await showSettings(page);
  await page.locator('#drill').click();
  assert.ok(await page.locator('#policy button, #plan button').evaluateAll(xs => xs.every(x => x.disabled)));
  assert.match(await page.locator('.card.drill').innerText(), /Each level checks whether you match the classic ranking/);
  await page.locator('#practice').click();
  assert.equal(query().get('policy'), 'draft');
  await showSettings(page);
  assert.equal(await pressed('#policy'), 'Look-ahead');

  // Blind practice with the look-ahead on: nothing is revealed before Keep.
  await page.goto(last + '&policy=draft&best=0', { waitUntil: 'networkidle' });
  assert.deepEqual(await ring(), []);
  assert.equal(await page.locator('.best-card, #marks .badge, #marks .road, .lookahead-note').count(), 0);
  await page.locator('#hits .vx[aria-label="Corner 33"]').press('Enter');
  assert.match(await page.locator('.pick-card h2').innerText(), /preview/);
  assert.doesNotMatch(await page.locator('.pick-card').innerText(), /Opening value|Second settlement|\d+\.\d\d/);
  await page.locator('#keep').click();
  assert.match(await page.locator('.verdict h2').first().innerText(), /#1 of \d+/);

  // Six players on the large board: time the switch.
  await page.goto(BASE + '?players=6&seed=11&seat=1', { waitUntil: 'networkidle' });
  await showSettings(page);
  const t6 = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('#policy button')].find(b => b.textContent === 'Look-ahead');
    const t = performance.now(); button.click(); return performance.now() - t;
  });
  assert.equal(await page.locator('.best-ring').count() > 0, true);
  console.log(`look-ahead switch rendered in ${t6.toFixed(0)} ms (6 players, measured in the page)`);

  await browser.close();
  assert.deepEqual(errs, []);
  console.log('LOOKAHEAD E2E OK, zero page errors');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

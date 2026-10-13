// Your plan, and the withdrawn look-ahead ranking. The look-ahead lost to the classic ranking in its predeclared
// benchmark (2026-10-12), so the page no longer offers it: Table settings has no Ranking control, and a link that asks
// for it opens the classic ranking and says so once. Plan choice: the link round-trips, the note and summary name it,
// Cities & Knights keeps its own weighting, Drill locks it, and hostile values fall back to the defaults.
const { BASE, launch, showSettings } = require('./helpers.cjs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const pressed = sel => page.locator(`${sel} button[aria-pressed="true"]`).innerText();
  const ring = () => page.locator('.best-ring').evaluateAll(xs => xs.map(x => Number(x.dataset.corner)));
  const query = () => new URL(page.url()).searchParams;
  // Seed 3, seat 4 of 4, seats 1 to 3 already placed: the classic top corner is 41 (the look-ahead's was 33).
  const last = BASE + '?players=4&seed=3&seat=4&opp=43,3,20&seq=o43,o3,o20';

  // No Ranking control, and the classic ranking.
  await page.goto(last, { waitUntil: 'networkidle' });
  await showSettings(page);
  assert.equal(await page.locator('#policy').isVisible(), false, 'the look-ahead is not offered');
  assert.equal(await page.locator('#policy button').count(), 0);
  assert.equal(await pressed('#plan'), 'By seat');
  assert.deepEqual(await ring(), [41]);

  // A look-ahead link opens the classic ranking and says why once; the address no longer asks for it.
  await page.goto(last + '&policy=draft-aware-2026-10-12', { waitUntil: 'networkidle' });
  await showSettings(page);
  assert.deepEqual(await ring(), [41], 'the classic ranking');
  assert.match(await page.locator('#plan-note').innerText(), /this link asks for the look-ahead ranking, which was withdrawn after testing, so the classic ranking is shown/);
  assert.equal(await page.locator('.lookahead-note, .alternative-note, .stability').count(), 0, 'no look-ahead notes');
  assert.doesNotMatch(await page.locator('.best-card .stat').innerText(), /Opening value/);
  assert.equal(query().has('policy'), false);
  await page.reload({ waitUntil: 'networkidle' });
  await showSettings(page);
  assert.doesNotMatch(await page.locator('#plan-note').innerText(), /withdrawn/, 'said once');

  // Unknown and hostile values fall back to the defaults; an unknown ranking says so; an explicit classic link does not.
  await page.goto(BASE + '?players=4&seed=3&policy=evil&plan=%3Cb%3E', { waitUntil: 'networkidle' });
  await showSettings(page);
  assert.equal(await pressed('#plan'), 'By seat');
  assert.match(await page.locator('#plan-note').innerText(), /this link names a ranking this version does not have, so the classic ranking is shown/);
  await page.goto(BASE + '?players=4&seed=3&seat=4&policy=classic', { waitUntil: 'networkidle' });
  await showSettings(page);
  assert.match(await page.locator('#plan-note').innerText(), /plan/);
  assert.doesNotMatch(await page.locator('#plan-note').innerText(), /names a ranking|withdrawn/);

  // A plan for your own seat: link, note and summary, kept through a reload.
  await page.goto(last, { waitUntil: 'networkidle' });
  await showSettings(page);
  await page.locator('#plan button', { hasText: 'Cities' }).click();
  assert.equal(query().get('plan'), 'ows');
  assert.match(await page.locator('#plan-note').innerText(), /\(your choice\)/);
  assert.match(await page.locator('#table-summary').innerText(), /Cities plan$/);
  await page.reload({ waitUntil: 'networkidle' });
  await showSettings(page);
  assert.equal(await pressed('#plan'), 'Cities');

  // Cities & Knights keeps its own weighting and locks the plan.
  await page.locator('#cak').click();
  assert.ok(await page.locator('#plan button').evaluateAll(xs => xs.every(x => x.disabled)), 'plan choice is off under Cities & Knights');
  assert.match(await page.locator('#plan-note').innerText(), /Cities & Knights plan/);
  await page.locator('#cak').click();

  // Drill uses the seat rule and locks the plan; leaving it restores the choice.
  await page.locator('#drill').click();
  assert.ok(await page.locator('#plan button').evaluateAll(xs => xs.every(x => x.disabled)));
  assert.match(await page.locator('.card.drill').innerText(), /Each level checks whether you match the classic ranking/);
  await page.locator('#practice').click();
  assert.equal(query().get('plan'), 'ows');
  await showSettings(page);
  assert.equal(await pressed('#plan'), 'Cities');
  await page.locator('#plan button', { hasText: 'By seat' }).click();
  assert.equal(query().has('plan'), false);

  await browser.close();
  assert.deepEqual(errs, []);
  console.log('PLAN AND WITHDRAWN LOOK-AHEAD E2E OK, zero page errors');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

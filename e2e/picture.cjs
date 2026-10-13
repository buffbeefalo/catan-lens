// Reading a board from a picture in the page: choose a picture, tap the four corner tokens, check the guesses drawn
// on it, use them, and the board editor holds exactly those tiles, with the unsure ones outlined and harbours left
// to add. Cancel, a file that is not a picture and taps out of order change nothing, and the picture is never sent
// anywhere. Runs the 19-tile and the 30-tile layouts, and a phone-sized touch screen.
const { BASE, ENGINE, launch } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'test', 'fixtures', 'imageread');
const truth = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8')).images.map(i => [i.file, i]));
const CORNER_TILES = { base: [0, 2, 18, 16], ext56: [0, 2, 29, 27] };   // top left, top right, bottom right, bottom left
const NAMES = { wood: 'Wood', brick: 'Brick', wheat: 'Wheat', sheep: 'Sheep', ore: 'Ore', desert: 'Desert' };

// Taps a picture point (in the picture's own pixels) on the canvas, wherever the dialog has scaled it to.
async function tapPicture(page, point, touch) {
  const canvas = page.locator('#picture-canvas');
  const { w, h, cw, ch } = await canvas.evaluate(c => ({ w: c.width, h: c.height, cw: c.getBoundingClientRect().width, ch: c.getBoundingClientRect().height }));
  const position = { x: point.x * cw / w, y: point.y * ch / h };
  if (touch) await canvas.tap({ position }); else await canvas.click({ position });
}
const editorTiles = page => page.locator('polygon.hex[data-hex]').evaluateAll(xs => xs.map(p => ({ id: Number(p.dataset.hex), title: p.querySelector('title').textContent, check: p.classList.contains('check') })));

async function readPicture(page, file, { touch = false } = {}) {
  const shot = truth[file];
  await page.locator('#picture-read').click();
  await page.locator('#picture-file').setInputFiles(path.join(dir, file));
  await page.waitForFunction(() => /Tap the number token on the top left tile/.test(document.querySelector('#picture-step').textContent));
  for (const id of CORNER_TILES[shot.setup]) await tapPicture(page, shot.hexes[id], touch);
  await page.waitForFunction(() => !document.querySelector('#picture-use').disabled, null, { timeout: 10000 });
  return shot;
}

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1300 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const origin = new URL(BASE).origin, elsewhere = [];
  page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) elsewhere.push(r.url()); });

  await page.goto(BASE + '?seed=5&players=4', { waitUntil: 'networkidle' });
  await page.locator('#custom').click();
  const before = await editorTiles(page);
  const dialog = page.locator('dialog.picture-dialog');

  // Cancel, a file that is not a picture, and a picture that will not decode: nothing changes on the board.
  await page.locator('#picture-read').click();
  assert.ok(await dialog.evaluate(d => d.open));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'picture-file', 'the dialog starts on its file chooser');
  assert.match(await page.locator('#picture-step').innerText(), /Choose a picture of a 19-tile board/);
  await page.locator('#picture-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a board') });
  assert.match(await page.locator('#picture-step').innerText(), /That file is not a picture/);
  await page.locator('#picture-file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') });
  await page.waitForFunction(() => /could not be opened/.test(document.querySelector('#picture-step').textContent));
  await page.locator('#picture-cancel').click();
  assert.equal(await dialog.evaluate(d => d.open), false);
  assert.deepEqual(await editorTiles(page), before, 'Cancel leaves the board alone');

  // Taps out of order are refused with a reason, and Undo takes the last one back.
  const photo = truth['photo-base-9.png'];
  await page.locator('#picture-read').click();
  await page.locator('#picture-file').setInputFiles(path.join(dir, 'photo-base-9.png'));
  await page.waitForFunction(() => /top left tile/.test(document.querySelector('#picture-step').textContent));
  for (const id of [0, 2, 16, 18]) await tapPicture(page, photo.hexes[id]);
  assert.match(await page.locator('#picture-step').innerText(), /must go around the board in order[\s\S]*Undo a tap and try again/);
  assert.ok(await page.locator('#picture-use').isDisabled());
  await page.locator('#picture-undo').click(); await page.locator('#picture-undo').click();
  assert.match(await page.locator('#picture-step').innerText(), /bottom right tile, shown on the small map \(3 of 4\)/);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(d => d.open), false);
  assert.deepEqual(await editorTiles(page), before, 'Escape leaves the board alone');

  // A photo-like picture, taken at an angle: every tile and number lands in the editor.
  elsewhere.length = 0;
  let started = Date.now();
  await readPicture(page, 'photo-base-9.png');
  console.log(`read a 19-tile photo in ${Date.now() - started} ms including four taps`);
  assert.match(await page.locator('#picture-step').innerText(), /^Read 19 tiles: [\s\S]*Harbours are not read/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'picture-use', 'a finished read moves to Use these tiles');
  await page.locator('#picture-use').click();
  let tiles = await editorTiles(page);
  assert.deepEqual(tiles.map(t => t.title), photo.hexes.map(h => `${NAMES[h.resource]}${h.number ? ' ' + h.number : ''}`));
  assert.match(await page.locator('#panel').innerText(), /harbour/i, 'harbours are left for the player to add or ignore');
  assert.deepEqual(elsewhere, [], 'the picture is never sent anywhere');

  // An unfamiliar board style: every guess is outlined, the editor says why, and fixing a tile clears its outline.
  await readPicture(page, 'unseen-base-13.png');
  assert.ok(await page.locator('#picture-notes li').count() > 0, 'the reader explains what it was unsure about');
  await page.locator('#picture-use').click();
  tiles = await editorTiles(page);
  const outlined = tiles.filter(t => t.check).map(t => t.id);
  assert.ok(outlined.length > 0, 'unsure tiles are outlined');
  assert.match(await page.locator('#picture-note').innerText(), /^Check the outlined tile/);
  await page.locator('#tool-wood').click();
  await page.locator(`polygon.hex[data-hex="${outlined[0]}"]`).click({ force: true });
  assert.equal((await editorTiles(page)).find(t => t.id === outlined[0]).check, false, 'painting a tile clears its outline');

  // A photo of a board turned about 90 degrees, with every token turned too: still every tile and number.
  await page.goto(BASE + '?seed=5&players=4', { waitUntil: 'networkidle' });
  await page.locator('#custom').click();
  const sideways = await readPicture(page, 'photo-sideways-base-27.png');
  await page.locator('#picture-use').click();
  assert.deepEqual((await editorTiles(page)).map(t => t.title), sideways.hexes.map(h => `${NAMES[h.resource]}${h.number ? ' ' + h.number : ''}`));

  // The 30-tile layout taps its own corner tiles.
  await page.goto(BASE + '?seed=4&players=6', { waitUntil: 'networkidle' });
  await page.locator('#custom').click();
  const ext = await readPicture(page, 'app-ext56-4.png');
  await page.locator('#picture-use').click();
  assert.deepEqual((await editorTiles(page)).map(t => t.title), ext.hexes.map(h => `${NAMES[h.resource]}${h.number ? ' ' + h.number : ''}`));
  await page.close();

  // A phone-sized touch screen: taps on a picture scaled down to fit.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  phone.on('pageerror', e => errs.push(e.message));
  await phone.goto(BASE + '?seed=5&players=4', { waitUntil: 'networkidle' });
  await phone.locator('#custom').tap();
  const app = await readPicture(phone, 'app-base-1.png', { touch: true });
  const fits = await phone.locator('dialog.picture-dialog').evaluate(d => d.getBoundingClientRect().right <= innerWidth && d.querySelector('canvas').getBoundingClientRect().width <= innerWidth);
  assert.ok(fits, 'the dialog and the picture fit the phone screen');
  await phone.locator('#picture-use').tap();
  assert.deepEqual((await editorTiles(phone)).map(t => t.title), app.hexes.map(h => `${NAMES[h.resource]}${h.number ? ' ' + h.number : ''}`));

  await browser.close();
  assert.deepEqual(errs, []);
  console.log(`PICTURE E2E OK (${ENGINE}), zero page errors`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

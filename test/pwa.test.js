// The installable app: the manifest and its icons are valid, and the offline copy (sw.js) saves every file the
// board page needs, so adding a module cannot silently break offline starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
const read = file => readFileSync(new URL(file, pub), 'utf8');
const shell = (() => {
  const m = read('sw.js').match(/const SHELL = \[([^\]]*)\]/);
  assert.ok(m, 'sw.js declares its SHELL list');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
})();

// Every module the page loads: app.js and everything it imports, followed transitively.
function modules(entry) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, dep] of read(file).matchAll(/^import[^'"]*['"]\.\/([^'"]+)['"]/gm)) visit(dep);
  };
  visit(entry);
  return [...seen];
}

function pngSize(file) {
  const b = readFileSync(new URL(file, pub));
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('the offline copy includes every module the board page imports', () => {
  const needed = modules('app.js');
  assert.ok(needed.includes('drill.js') && needed.includes('score.js'), 'the import scan finds the app modules');
  for (const file of needed) assert.ok(shell.includes(file), `sw.js SHELL is missing ${file}`);
});

test('the offline copy includes the page, its styles, the help page and every manifest icon', () => {
  for (const file of ['./', 'index.html', 'style.css', 'how-it-works.html', 'manifest.webmanifest']) assert.ok(shell.includes(file), file);
  for (const icon of JSON.parse(read('manifest.webmanifest')).icons) assert.ok(shell.includes(icon.src), icon.src);
  for (const file of shell.filter(f => f !== './')) assert.ok(existsSync(new URL(file, pub)), `${file} exists`);
});

test('the manifest makes the app installable: name, start page, standalone display and sized icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Catan Lens');
  assert.ok(m.short_name && m.short_name.length <= 12, 'a home-screen label short enough not to be cut off');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const png = m.icons.filter(i => i.type === 'image/png');
  for (const want of ['192x192', '512x512']) assert.ok(png.some(i => i.sizes === want && i.purpose === 'any'), `an ordinary ${want} icon`);
  assert.ok(png.some(i => i.purpose === 'maskable'), 'a maskable icon for Android shapes');
  for (const icon of png) assert.deepEqual(pngSize(icon.src), icon.sizes.split('x').map(Number), `${icon.src} has its declared size`);
});

test('the page links the manifest, the touch icon and the offline copy', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
  assert.match(html, /navigator\.serviceWorker\.register\('sw\.js'\)/);
});

test('the local server sends the manifest with its own content type', () => {
  const serve = readFileSync(new URL('../serve.js', import.meta.url), 'utf8');
  assert.match(serve, /'\.webmanifest': 'application\/manifest\+json/);
});

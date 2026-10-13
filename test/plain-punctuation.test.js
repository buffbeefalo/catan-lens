// User-facing text uses plain punctuation: no em dash (U+2014) or en dash (U+2013) in the site's pages, scripts,
// styles and captions, or in any tracked Markdown. Write ranges as "3 to 4"; use a colon, a comma or parentheses for
// an aside. The minus sign (U+2212) in numbers is not a dash and stays allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const checked = tracked.filter(f => /^public\/.+\.(js|html|css|webmanifest|vtt|txt|json)$/.test(f) || /\.md$/.test(f) || /^study\/.+\.(js|mjs|html)$/.test(f));

test('no em or en dashes in user-facing text', () => {
  assert.ok(checked.length > 30, 'the scan finds the site and the documents');
  const found = [];
  for (const file of checked) readFileSync(join(root, file), 'utf8').split('\n').forEach((line, i) => { if (/[–—]/.test(line)) found.push(`${file}:${i + 1}`); });
  assert.deepEqual(found, []);
});

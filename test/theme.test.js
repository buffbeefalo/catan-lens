// The light and dark themes: every color comes from a token, both dark blocks agree, and every text/background pair
// the app actually uses stays readable (WCAG AA, 4.5:1) in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(re) {
  const m = css.match(re);
  assert.ok(m, `missing block ${re}`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}
const light = block(/^:root\{([^}]*)\}/m);
const dark = block(/:root\[data-theme="dark"\]\{([^}]*)\}/);
const system = block(/@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{([^}]*)\}\}/);

function rgb(v) {
  const h = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!h) return null;
  const s = h[1].length === 3 ? [...h[1]].map(c => c + c).join('') : h[1];
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
}
const lum = c => { const [r, g, b] = c.map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [text, background, why]
const PAIRS = [
  ['ink', 'bg', 'body text'], ['ink', 'card', 'text on cards and inputs'], ['mut', 'bg', 'secondary text'], ['mut', 'card', 'secondary text on cards'],
  ['accent', 'bg', 'links and good grades'], ['red', 'bg', 'weak grades and red numbers'], ['amber', 'bg', 'fair grades and cautions'],
  ['on-ink', 'ink', 'text on filled buttons'], ['on-accent', 'accent', 'text on green fills'], ['on-accent2', 'accent2', 'text on gold toggles'],
  ['disc-ink', 'disc', 'numbers on tokens and badges'], ['disc-red', 'disc', 'red 6 and 8 on tokens'],
  ...['wood', 'brick', 'wheat', 'sheep', 'ore', 'desert'].map(h => ['hex-ink', h, `terrain label on ${h}`]),
];

test('both dark blocks define the same tokens with the same values', () => {
  assert.deepEqual(system, dark);
});

test('every dark token also has a light value', () => {
  for (const k of Object.keys(dark)) assert.ok(k in light, `--${k} has no light value`);
});

for (const [name, theme] of [['light', light], ['dark', { ...light, ...dark }]]) {
  test(`${name} theme: every text/background pair reads at 4.5:1 or better`, () => {
    for (const [fg, bg, why] of PAIRS) {
      const a = rgb(theme[fg] || ''), b = rgb(theme[bg] || '');
      assert.ok(a && b, `--${fg} and --${bg} must be plain hex colors (${why})`);
      assert.ok(contrast(a, b) >= 4.5, `${why}: --${fg} on --${bg} is ${contrast(a, b).toFixed(2)}:1 in the ${name} theme`);
    }
  });
}

test('no rule outside the token blocks uses a literal color', () => {
  const rules = css.replace(/^:root\{[^}]*\}/m, '').replace(/:root\[data-theme="dark"\]\{[^}]*\}/, '')
    .replace(/@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{[^}]*\}\}/, '');
  const literals = rules.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi) || [];
  assert.deepEqual(literals, [], 'use a token instead');
});

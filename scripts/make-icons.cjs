// Draws the home-screen icons from the logo (docs/media/logo-light.svg): `node scripts/make-icons.cjs`.
// Development only (uses Playwright's Chromium to rasterise). Writes public/icons/.
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '..', 'public', 'icons');
const BG = '#f4efe4', INK = '#1d2b1f', GOLD = '#d9a93a';
// The logo's hexagon and lens, centred in a 182-unit box (its own viewBox is -6 -6 182 182).
const LOGO = `<path d="M84 10 L148 47 L148 121 L84 158 L20 121 L20 47 Z" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`
  + `<circle cx="148" cy="121" r="17" fill="none" stroke="${GOLD}" stroke-width="7"/><circle cx="148" cy="121" r="6" fill="${GOLD}"/>`;
// `scale` = share of the icon the logo box fills. Maskable icons keep the logo inside the central safe circle.
const svg = ({ rounded, scale }) => {
  const box = 182, size = box / scale, pad = (size - box) / 2;
  const radius = rounded ? size * 0.2 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-6 - pad} ${-6 - pad} ${size} ${size}">`
    + `<rect x="${-6 - pad}" y="${-6 - pad}" width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>${LOGO}</svg>`;
};

const ICONS = [
  { file: 'icon-192.png', px: 192, rounded: true, scale: 0.78 },
  { file: 'icon-512.png', px: 512, rounded: true, scale: 0.78 },
  { file: 'maskable-512.png', px: 512, rounded: false, scale: 0.6 },
  { file: 'apple-touch-icon.png', px: 180, rounded: false, scale: 0.72 },
];

(async () => {
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'icon.svg'), svg({ rounded: true, scale: 0.78 }) + '\n');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.px, height: icon.px }, deviceScaleFactor: 1 });
    const markup = svg(icon).replace('<svg ', `<svg width="${icon.px}" height="${icon.px}" `);
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`);
    await page.locator('svg').screenshot({ path: path.join(out, icon.file), omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log(`wrote icon.svg and ${ICONS.length} PNG icons to public/icons/`);
})().catch(e => { console.error(e); process.exit(1); });

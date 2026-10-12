// Every internal link resolves: relative links in tracked Markdown and in the site's HTML point at files that exist,
// and every #anchor matches a heading (Markdown, GitHub's slug rules) or an id (HTML). The site deploys public/ plus
// docs/RESEARCH.md alone, so RESEARCH.md may only use absolute links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const markdown = tracked.filter(f => f.endsWith('.md'));
const pages = tracked.filter(f => /^public\/[^/]+\.html$/.test(f));
const slug = heading => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const anchorsOf = file => file.endsWith('.md')
  ? new Set(readFileSync(join(root, file), 'utf8').split('\n').filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, ''))))
  : new Set([...readFileSync(join(root, file), 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const linksIn = (file, text) => file.endsWith('.md')
  ? [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1])
  : [...text.matchAll(/\s(?:href|src)="([^"]+)"/g)].map(m => m[1]);
const external = target => /^(https?:|mailto:|data:|javascript:)/.test(target);
// The site maps docs/RESEARCH.md beside the pages (pages.yml copies it to docs/ inside the site).
const onSite = { 'public/docs/RESEARCH.md': 'docs/RESEARCH.md' };
// The demo videos are attached to the latest GitHub release and copied into the site at deploy time, not stored in git.
const releaseAssets = new Set(['public/media/overview.mp4', 'public/media/walkthrough.mp4']);

test('relative links and anchors in Markdown and site pages all resolve', () => {
  const broken = [];
  for (const file of [...markdown, ...pages]) {
    const text = readFileSync(join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const raw of linksIn(file, text)) {
      if (external(raw) || raw.includes('${')) continue;
      const [path, anchor] = raw.split('#');
      let target = path ? normalize(join(dirname(file), decodeURIComponent(path.split('?')[0]))) : file;
      target = onSite[target] || target;
      if (path === '' && !anchor) continue;
      if (releaseAssets.has(target)) continue;
      if (!existsSync(join(root, target))) { broken.push(`${file}: ${raw} (no file)`); continue; }
      if (anchor && /\.(md|html)$/.test(target) && !anchorsOf(target).has(anchor)) broken.push(`${file}: ${raw} (no anchor)`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the research document published on the site uses only absolute links', () => {
  const text = readFileSync(join(root, 'docs/RESEARCH.md'), 'utf8');
  const relative = linksIn('docs/RESEARCH.md', text).filter(t => !external(t) && !t.startsWith('#'));
  assert.deepEqual(relative, []);
});

// `npm run e2e`: every browser walkthrough, then the usability suite. Starts the local server unless
// CATAN_URL points at a deployment already running. Walkthroughs run in a temp dir so their
// screenshots never overwrite anything in the repo.
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const WALKS = ['audit', 'drill', 'verdict', 'draft', 'focus', 'custom', 'fold'];

(async () => {
  let server = null;
  if (!process.env.CATAN_URL) {
    server = spawn(process.execPath, [path.join(root, 'serve.js')], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((ok, fail) => { server.stdout.once('data', ok); server.once('exit', code => fail(new Error('server exited ' + code))); });
  }
  const cwd = mkdtempSync(path.join(tmpdir(), 'catan-e2e-'));
  let failed = 0;
  for (const w of WALKS) {
    const r = spawnSync(process.execPath, [path.join(__dirname, w + '.cjs')], { cwd, encoding: 'utf8' });
    const last = (r.stdout.trim().split('\n').pop() || '').trim();
    console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${w}: ${last}`);
    if (r.status !== 0) { failed++; process.stderr.write(r.stdout + r.stderr); }
  }
  const u = spawnSync(process.execPath, ['--test', path.join(__dirname, 'usability.cjs')], { cwd: root, stdio: 'inherit' });
  if (u.status !== 0) failed++;
  if (server) server.kill();
  console.log(failed ? `${failed} suite(s) failed` : 'all browser suites passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

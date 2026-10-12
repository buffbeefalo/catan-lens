// `npm run e2e`: every browser walkthrough, then the usability and starting-road suites, in the engine CATAN_BROWSER
// names (chromium by default). Starts the local server unless CATAN_URL points at a deployment already running.
// Walkthroughs run in a temp dir so their screenshots never overwrite anything in the repo.
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { ENGINE, launch } = require('./helpers.cjs');   // an unknown CATAN_BROWSER stops the run here

const root = path.join(__dirname, '..');
const WALKS = ['audit', 'drill', 'verdict', 'draft', 'focus', 'custom', 'fold', 'theme', 'pwa', 'lookahead'];

(async () => {
  // A missing or broken engine is reported once, as such, before any suite runs.
  const probe = await launch().catch(e => { console.error(`${ENGINE} could not start (install it with npx playwright install --with-deps ${ENGINE}):\n${e.message}`); process.exit(1); });
  console.log(`browser suites in ${ENGINE} ${probe.version()}`);
  await probe.close();
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
  const walksPassed = WALKS.length - failed;
  // The usual report on screen, plus a TAP copy of each suite to count passes and skips; a skipped check never counts
  // as passed.
  const SUITES = ['usability.cjs', 'starting-roads.cjs'];
  for (const suite of SUITES) {
    const u = spawnSync(process.execPath, ['--test', `--test-reporter=${process.stdout.isTTY ? 'spec' : 'tap'}`, '--test-reporter-destination=stdout',
      '--test-reporter=tap', '--test-reporter-destination=' + path.join(cwd, suite + '.tap'), path.join(__dirname, suite)], { cwd: root, stdio: 'inherit' });
    if (u.status !== 0) failed++;
  }
  if (server) server.kill();
  const totals = SUITES.map(suite => {
    const tap = path.join(cwd, suite + '.tap'), report = existsSync(tap) ? readFileSync(tap, 'utf8') : '';
    const count = key => Number((report.match(new RegExp(`^# ${key} (\\d+)$`, 'm')) || [])[1] || 0);
    for (const [, name, why] of report.matchAll(/^ok \d+ - (.*) # SKIP ?(.*)$/gm)) console.log(`skipped in ${ENGINE}: ${name} (${why || 'no reason given'})`);
    return `${suite.replace('.cjs', '')} ${count('pass')} passed, ${count('skipped')} skipped, ${count('fail')} failed of ${count('tests')}`;
  });
  console.log(`${ENGINE}: walkthroughs ${walksPassed} of ${WALKS.length} passed; ${totals.join('; ')}`);
  console.log(failed ? `${failed} suite(s) failed` : 'all browser suites passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

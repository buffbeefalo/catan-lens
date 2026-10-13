// Acceptance checks for starting-road grading. Offline: it needs Node 22, the installed playwright package and its
// Chromium (or CHROMIUM_PATH), and downloads nothing.
//   node scripts/verify-starting-roads.mjs --unit       the unit suite plus the starting-road unit tests
//   node scripts/verify-starting-roads.mjs --browser    every browser suite plus the starting-road suite, on a local server
//   node scripts/verify-starting-roads.mjs --mutations  targeted mutations in a temporary copy; an assertion must catch each one
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tests that must run and pass; a missing or skipped one fails the check.
const UNIT_TESTS = [
  'the frozen reference is the original scorer, unedited apart from its two import paths',
  'suggested roads, settlement scores and rankings match the original scorer (300 seeds, 4 seats, 2 settlements)',
  'contested and empty road evaluations match the original scorer too',
  'every suggested road grades Great with the same inputs, and only genuine ties share it',
  'exact ties share Great; a target 0.01 lower is a near tie, not a tie',
  'an equally good target with fewer open corners that way ranks below, and says so',
  'the Fair line is the settlement grades’ 90% line whenever the best score is positive',
  'zero scores compare too: an equal zero target with fewer corners is Fair, not Weak',
  'a road with no target is Weak and says why: blocked by the projection, or no legal site at all',
  'with no target in any direction there is no grade, only the two-road limit',
  'revealed road text keeps the contested and own-second-settlement qualifications',
  'the placement context reads the history up to the settlement, skips roads, and is null for a settlement with no entry',
  'drawn road advice never drifts: through every later placement each kept settlement keeps the road it was given when kept, and that road grades Great',
  'listing the settlement itself in its position changes no road advice or grade',
];
const BROWSER_TESTS = [
  'first-pick feedback keeps future road hints hidden during blind practice',
  'an unavailable two-road hint explains its search limit',
  'a starting road you place is graded, moves, undoes and survives a reload',
  'Undo takes back a road without touching an opponent mark that shares its number',
  'a road entered late is still graded as of its settlement’s turn',
  'blind practice holds a placed road’s grade until both settlements are down, then shows only the grade',
  'a kept settlement’s suggested road is the one its road grade calls best, however much is placed later',
  'road placement stays out of opponent marking, open previews and Drill',
  'a road tied for the best direction is not shown a better side',
  'road tokens that do not fit the board are dropped from a shared link',
  'roads are optional and never change the settlements, their order or the projected draft',
  'a road placed late, or moved later, is still judged on its settlement’s own turn',
  'a link from before roads loads exactly as it did, and the latest valid road for a settlement wins',
  'a settlement with no two-road target gets no grade, with hints on or off',
  'in Your board, a kept settlement takes and grades a road the same way',
  'previewing a corner and keeping it draws the same road, and later marks or Undo do not move it',
  'in the original order of the search-limit fixture, the second settlement keeps the road of its own turn',
  'a link without a placement order lists opponents first, and roads are advised from that order',
  'Drill keeps drawing a placed settlement’s road from the board as it is now, as before roads',
];

// Each mutation breaks one rule; `tests` picks the regressions expected to catch it (a name pattern).
const MUTATIONS = [
  { name: 'R13 drift: fewer options win a tie', file: 'public/score.js', kind: 'unit', tests: 'match the original scorer',
    old: '(c.target.score === pick.target.score && c.options > pick.options)', new: '(c.target.score === pick.target.score && c.options < pick.options)' },
  { name: 'R13 drift: targets sorted worst first', file: 'public/score.js', kind: 'unit', tests: 'match the original scorer',
    old: '.map(score).sort((a, b) => b.score - a.score || b.pips - a.pips || a.id - b.id);', new: '.map(score).sort((a, b) => a.score - b.score || b.pips - a.pips || a.id - b.id);' },
  { name: 'Fair line strict', file: 'public/score.js', kind: 'unit', tests: 'Fair line|zero scores',
    old: '10 * (bestUnits - units) <= Math.abs(bestUnits)', new: '10 * (bestUnits - units) < Math.abs(bestUnits)' },
  { name: 'Fair line ignores the sign of the best score', file: 'public/score.js', kind: 'unit', tests: 'Fair line',
    old: '10 * (bestUnits - units) <= Math.abs(bestUnits)', new: '10 * (bestUnits - units) <= bestUnits' },
  { name: 'rank ignores the number of options', file: 'public/score.js', kind: 'unit', tests: 'fewer open corners that way',
    old: ' || (value(d) === value(own) && d.targets.length > own.targets.length)).length;', new: ').length;' },
  { name: 'Great by rounded score', file: 'public/score.js', kind: 'unit', tests: 'near tie',
    old: 'reaching.filter(d => value(d) > value(own)', new: 'reaching.filter(d => Math.round(value(d) * 10) > Math.round(value(own) * 10)' },
  { name: 'no ungraded case', file: 'public/score.js', kind: 'unit', tests: 'no target in any direction',
    old: "  if (!reaching.length) return { tier: 'none'", new: "  if (false) return { tier: 'none'" },
  { name: 'projection-blocked reads as no legal site', file: 'public/score.js', kind: 'unit', tests: 'blocked by the projection',
    old: "why: blocked ? 'the open corners this way are taken or blocked by another seat in the projected opening.'", new: "why: false ? 'the open corners this way are taken or blocked by another seat in the projected opening.'" },
  { name: 'contested qualification dropped', file: 'public/score.js', kind: 'unit', tests: 'qualifications',
    old: "${contested ? ' Every direction is contested", new: "${false ? ' Every direction is contested" },
  { name: 'own-second-settlement qualification dropped', file: 'public/score.js', kind: 'unit', tests: 'qualifications',
    old: "${ownSecond?.id === t.id ? ' The opening projection also uses this target for your second settlement, so it would already be occupied when setup ends.' : ''}${contested",
    new: "${''}${contested" },
  { name: 'road graded on the live board', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'placed late, or moved later',
    old: 'gradeRoad(analysisBoard, settings(), h.id, edge, roadContext(h.id))', new: 'gradeRoad(analysisBoard, settings(), h.id, edge, { mine: state.me, occupied: [...state.me, ...state.opp] })' },
  { name: 'kept settlement advice from the live board', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'suggested road is the one|original order of the search-limit|without a placement order',
    old: '!state.drill && state.me.includes(id) ? placementContext(state.history, id) : {', new: 'false ? placementContext(state.history, id) : {' },
  { name: 'a link without a placement order advised from the live board', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'without a placement order',
    old: '!state.drill && state.me.includes(id) ? placementContext(state.history, id) : {', new: 'false ? placementContext(state.history, id) : {' },
  { name: 'Drill advised from the rebuilt placement history', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'Drill keeps drawing',
    old: '!state.drill && state.me.includes(id) ? placementContext(state.history, id) : {', new: 'state.me.includes(id) ? placementContext(state.history, id) : {' },
  { name: 'road evaluation leaves the settlement itself out', file: 'public/score.js', kind: 'unit', tests: 'listing the settlement itself|never drifts',
    old: 'const taken = new Set([...occupied, vid]);\n  const mineAfter = mine.includes(vid) ? mine : [...mine, vid];', new: 'const taken = new Set(occupied);\n  const mineAfter = mine;' },
  { name: 'placement position one entry short', file: 'public/score.js', kind: 'unit', tests: 'placement context|never drifts',
    old: 'history.slice(0, at)', new: 'history.slice(0, Math.max(0, at - 1))' },
  { name: 'placement position takes in the next settlement placed', file: 'public/score.js', kind: 'unit', tests: 'placement context|never drifts',
    old: 'history.slice(0, at)', new: "history.slice(0, at).concat(history.slice(at + 1).filter(h => h.k !== 'road').slice(0, 1))" },
  { name: 'the settlement counted in its own position', file: 'public/score.js', kind: 'unit', tests: 'placement context',
    old: 'history.slice(0, at)', new: 'history.slice(0, at + 1)' },
  { name: 'road moves counted as settlements', file: 'public/score.js', kind: 'unit', tests: 'placement context',
    old: "history.slice(0, at).filter(h => h.k !== 'road')", new: 'history.slice(0, at)' },
  { name: 'missing settlement read from a truncated history', file: 'public/score.js', kind: 'unit', tests: 'placement context',
    old: '  if (at < 0) return null;\n', new: '' },
  { name: 'a Great road is shown a better side', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'tied for the best direction',
    old: "!['fair', 'weak'].includes(", new: "!['fair', 'weak', 'great'].includes(" },
  { name: 'a Weak road is not shown the better side', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'suggested road is the one',
    old: "!['fair', 'weak'].includes(", new: '![].includes(' },
  { name: 'a Great road is told of a better side', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'tied for the best direction',
    old: "  if (r && placed !== undefined && placed !== r.edge && gradeRoad(analysisBoard, settings(), id, placed, roadContext(id))?.tier === 'great') return '';\n", new: '' },
  { name: 'unknown link tokens become settlements', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'link from before roads',
    old: "user: piece[1] === 'm' } : null;", new: "user: piece[1] === 'm' } : { k: 'me', id: Number(t.slice(1)), user: false };" },
  { name: 'replay keeps roads that come before their settlement', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'do not fit the board',
    old: 'if (id !== undefined && roadOwner(id) === h.at && roadEdge(h.at) !== id)', new: 'if (id !== undefined && roadEdge(h.at) !== id)' },
  { name: 'Undo of a road removes an opponent mark', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'without touching an opponent mark',
    old: "else if (last.k === 'opp') {", new: 'else {' },
  { name: 'moving a road replaces it, so Undo cannot put it back', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'moves, undoes and survives',
    old: "state.history.push({ k: 'road', id: eid, at: vid,", new: "state.history = state.history.filter(h => !(h.k === 'road' && h.at === vid)); state.history.push({ k: 'road', id: eid, at: vid," },
  { name: 'road region swallows corner taps', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'moves, undoes and survives',
    old: 'if (d <= Math.min(0.45, reach) && (!side || d < side.d))', new: 'if (d <= 5 && (!side || d < side.d))' },
  { name: 'blind grade before the second settlement', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'blind practice holds',
    old: 'if (!reveal() && state.me.length < 2) return', new: 'if (!reveal() && state.me.length < 1) return' },
  { name: 'blind grade carries its reason', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'blind practice holds',
    old: "const why = reveal() ? `. ${esc(road.why[0].toUpperCase() + road.why.slice(1))}` : '';", new: 'const why = `. ${esc(road.why[0].toUpperCase() + road.why.slice(1))}`;' },
  { name: 'blind grade in quality colours', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'blind practice holds',
    old: "reveal() ? road.tier : 'placed'", new: 'road.tier' },
  { name: 'road slots in Drill', file: 'public/app.js', kind: 'browser', suite: 'starting-roads.cjs', tests: 'out of opponent marking',
    old: '!state.tool && !state.drill && entry.ready', new: '!state.tool && entry.ready' },
];

const fail = message => { console.error('FAIL ' + message); process.exitCode = 1; };
const node = (args, options) => spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...options });
const passedNames = tap => new Set([...tap.matchAll(/^\s*ok \d+ - (.+?)(?: # .*)?$/gm)].map(m => m[1]));
const summary = (tap, key) => [...tap.matchAll(new RegExp(`^# ${key} (\\d+)`, 'gm'))].reduce((n, m) => n + Number(m[1]), 0);   // summed over every suite

function requireAll(tap, names, label) {
  const passed = passedNames(tap);
  const missing = names.filter(n => !passed.has(n));
  if (missing.length) fail(`${label}: required tests did not run and pass:\n  ${missing.join('\n  ')}`);
  for (const key of ['fail', 'skipped', 'todo', 'cancelled']) if (summary(tap, key)) fail(`${label}: ${summary(tap, key)} ${key}`);
  return !missing.length;
}

function unitFiles(dir) {
  return [...readdirSync(join(dir, 'test')).filter(f => f.endsWith('.test.js')).sort().map(f => join('test', f)), join('test', 'starting-roads.test.mjs')];
}

function browserPrerequisites() {
  let executable;
  try { executable = process.env.CHROMIUM_PATH || createRequire(join(root, 'package.json'))('playwright').chromium.executablePath(); }
  catch (e) { return fail('playwright is not installed (run npm ci first): ' + e.message); }
  if (!existsSync(executable)) return fail(`no Chromium at ${executable}; install it beforehand (npx playwright install chromium) or set CHROMIUM_PATH`);
  return true;
}

const freePort = () => new Promise((ok, no) => { const s = createServer().once('error', no).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

// The repository's own zero-dependency server, serving `dir`; resolves once it is listening.
async function startServer(dir) {
  const port = await freePort();
  const server = spawn(process.execPath, [join(dir, 'serve.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, no) => { server.stdout.once('data', ok); server.once('exit', code => no(new Error('server exited ' + code))); });
  const stop = () => { if (server.exitCode === null) server.kill(); };
  process.once('exit', stop);
  return { url: `http://127.0.0.1:${port}/`, stop };
}

function unit() {
  const r = node(['--test', ...unitFiles(root)], { cwd: root });
  process.stdout.write(r.stdout.split('\n').filter(l => /^# (tests|pass|fail|skipped|todo|cancelled) /.test(l)).join('\n') + '\n');
  if (r.status !== 0) fail('unit suite exited ' + r.status + '\n' + r.stdout.split('\n').filter(l => /^not ok/.test(l)).join('\n'));
  if (requireAll(r.stdout, UNIT_TESTS, 'unit') && r.status === 0) console.log(`unit: ${summary(r.stdout, 'pass')} passed, all ${UNIT_TESTS.length} starting-road tests among them`);
}

async function browser() {
  if (!browserPrerequisites()) return;
  const server = await startServer(root);
  try {
    const r = node([join('e2e', 'run-all.cjs')], { cwd: root, env: { ...process.env, CATAN_URL: server.url }, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = r.stdout + r.stderr;
    process.stdout.write(out.split('\n').filter(l => /^(ok|FAIL)\s+\w|^not ok|^# (tests|pass|fail) |suites? (passed|failed)/.test(l)).join('\n') + '\n');
    if (r.status !== 0) fail('browser suites exited ' + r.status);
    if (requireAll(out, BROWSER_TESTS, 'browser') && r.status === 0) console.log(`browser: every suite passed, all ${BROWSER_TESTS.length} starting-road tests among them`);
  } finally { server.stop(); }
}

// A failure counts only when an assertion made it; a syntax error, a missing module or a dead server does not.
function verdict(r) {
  const out = r.stdout + r.stderr;
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map(m => m[1]);
  const asserted = /ERR_ASSERTION|AssertionError/.test(out);
  const broken = /SyntaxError|ReferenceError|ERR_MODULE_NOT_FOUND|ECONNREFUSED|net::ERR_|server exited/.test(out);
  if (r.status !== 0 && failed.length && asserted && !broken) return { killed: true, by: failed };
  return { killed: false, why: r.status === 0 ? 'survived: every selected test passed' : broken ? 'failed for a reason other than an assertion (syntax, module or server)' : 'failed without an assertion' };
}

async function mutations() {
  if (!browserPrerequisites()) return;
  const stage = mkdtempSync(join(tmpdir(), 'catan-road-mutations-'));
  let server;
  const cleanUp = () => { server?.stop(); rmSync(stage, { recursive: true, force: true }); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cleanUp(); process.exit(130); });
  try {
    for (const entry of ['public', 'test', 'e2e', 'serve.js', 'package.json']) cpSync(join(root, entry), join(stage, entry), { recursive: true });
    cpSync(join(root, 'docs', 'RESEARCH.md'), join(stage, 'docs', 'RESEARCH.md'));
    symlinkSync(join(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
    server = await startServer(stage);
    const run = m => m.kind === 'unit'
      ? node(['--test', '--test-name-pattern=' + m.tests, join('test', 'starting-roads.test.mjs')], { cwd: stage })
      : node(['--test', '--test-name-pattern=' + m.tests, join('e2e', m.suite)], { cwd: stage, env: { ...process.env, CATAN_URL: server.url } });
    // Every selected regression must pass on the untouched copy, or a "kill" would mean nothing.
    for (const pattern of new Set(MUTATIONS.map(m => `${m.kind}|${m.suite || ''}|${m.tests}`))) {
      const [kind, suite, tests] = pattern.split('|');
      const r = run({ kind, suite, tests });
      if (r.status !== 0 || !passedNames(r.stdout).size) return fail(`baseline: "${tests}" does not pass unmutated`);
    }
    const rows = [];
    for (const m of MUTATIONS) {
      const path = join(stage, m.file), original = readFileSync(path, 'utf8');
      const count = original.split(m.old).length - 1;
      if (count !== 1) { rows.push([m.name, `NOT APPLIED (target text found ${count} times)`]); fail(`mutation "${m.name}" was not applied`); continue; }
      writeFileSync(path, original.replace(m.old, m.new));
      try {
        const v = verdict(run(m));
        rows.push([m.name, v.killed ? 'killed by: ' + v.by.join('; ') : 'NOT KILLED: ' + v.why]);
        if (!v.killed) fail(`mutation "${m.name}" ${v.why}`);
      } finally { writeFileSync(path, original); }
    }
    for (const [name, result] of rows) console.log(`${name}\n    ${result}`);
    if (!process.exitCode) console.log(`mutations: all ${MUTATIONS.length} caught by assertions`);
  } finally { cleanUp(); }
}

const modes = { '--unit': unit, '--browser': browser, '--mutations': mutations };
if (!modes[process.argv[2]]) { console.error('usage: node scripts/verify-starting-roads.mjs --unit | --browser | --mutations'); process.exit(2); }
await modes[process.argv[2]]();

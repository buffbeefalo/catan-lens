// Study A analysis (study/README.md). Reads answer files downloaded from study/review.html and the positions file,
// works out what each Catan Lens policy would choose (only here, never on the review page) and reports agreement.
//   node study/analyze.mjs [--positions file.json] [--json results.json] answers.json [more.json ...]
// Agreement with reviewers is one source of evidence, not proof that any choice is best; the report says so.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PIPS } from '../public/board.js';
import { rankSpots, simulateDraft } from '../public/score.js';
import { rankLookahead, POLICY } from '../public/lookahead.js';
import { KIND, boardOf, cleanAnswer, openCorners } from './review.js';

const POLICIES = ['classic', 'lookahead', 'pips'];
const CODE = ['public/board.js', 'public/geometry.js', 'public/score.js', 'public/lookahead.js', 'study/review.js'];
const BANNER = 'SYNTHETIC DEMONSTRATION DATA: made up by a script to show this analysis running. These are not reviews and say nothing about either policy.';

// One answer file, checked against the positions with the review page's own rules. Anything that breaks them is
// listed in `problems` and left out (or ignored, for an optional field), never counted silently.
export function readAnswers(json, data, label) {
  if (!json || json.kind !== KIND) throw new Error(`${label} is not a Catan Lens answer file.`);
  if (json.study !== 'expert-review') throw new Error(`${label} is ${json.study === 'learning-test' ? 'a learning test (study B), not an expert review' : 'not marked as an expert review'}. Leave it out of this analysis.`);
  if (json.positions !== data.version) throw new Error(`${label} answers different positions (${json.positions}), not ${data.version}.`);
  if (typeof json.synthetic !== 'boolean') throw new Error(`${label} does not say whether it is synthetic.`);
  const byId = new Map(data.positions.map(p => [p.id, p])), seen = new Set(), ratings = [], problems = [];
  for (const raw of Array.isArray(json.answers) ? json.answers : []) {
    const p = byId.get(raw?.position), where = `${label}, ${raw?.position}`;
    if (!p) { problems.push(`${where}: no such position, left out`); continue; }
    if (seen.has(p.id)) { problems.push(`${where}: answered twice, only the first answer counts`); continue; }
    seen.add(p.id);
    const a = cleanAnswer(p, raw);
    if (a.choice === null) { problems.push(`${where}: choice ${raw.choice} is not an open corner, left out`); continue; }
    if (raw.plannedSecond != null && a.plannedSecond !== raw.plannedSecond) problems.push(`${where}: planned second ${raw.plannedSecond} is not allowed here, ignored`);
    const dropped = (Array.isArray(raw.acceptable) ? raw.acceptable : []).filter(n => n !== a.choice && !a.acceptable.includes(n));
    if (dropped.length) problems.push(`${where}: alternatives ${dropped.join(', ')} are not open corners, ignored`);
    if (raw.confidence != null && a.confidence === null) problems.push(`${where}: confidence ${raw.confidence} is not 1 to 5, ignored`);
    ratings.push({ position: p.id, ...a });
  }
  return { label: String(json.reviewer || '').trim() || label, synthetic: json.synthetic, ratings, problems };
}

export function checkMix(files) {
  const fake = files.filter(f => f.synthetic), real = files.filter(f => !f.synthetic);
  if (fake.length && real.length) throw new Error(`Refusing to mix synthetic demonstration files (${fake.map(f => f.label).join(', ')}) with real answer files (${real.map(f => f.label).join(', ')}). Analyse them separately.`);
}

// Each policy's choice for a position, as corner numbers: the classic ranking (score.js), the look-ahead ranking
// (lookahead.js) and a simple baseline, the corner with the most raw pips (lowest number on ties, as in the benchmark).
// For a first-settlement task, also each policy's planned opening: its choice and its projected second settlement.
export function policyChoices(p) {
  const board = boardOf(p), settings = { players: p.players, seat: p.seat, cak: false };
  const id = n => n - 1, occupied = p.placed.map(x => id(x.corner));
  const me = p.placed.filter(x => x.seat === p.seat).map(x => id(x.corner)), opp = p.placed.filter(x => x.seat !== p.seat).map(x => id(x.corner));
  const classic = rankSpots(board, settings, { mine: me, occupied, explain: false })[0].id;
  const look = rankLookahead(board, settings, { me, opp })[0];
  const open = openCorners(p);
  const pipsAt = n => board.graph.vertices[id(n)].hexes.reduce((s, h) => s + (board.hexes[h].number ? PIPS[board.hexes[h].number] : 0), 0);
  const out = { classic: classic + 1, lookahead: look.id + 1, pips: open.reduce((a, n) => (pipsAt(n) > pipsAt(a) ? n : a)), open: open.length };
  if (p.task === 'first') {
    const second = simulateDraft(board, settings, { me: [classic], opp }).find(d => d.you && d.round === 2);
    out.classicOpening = [classic + 1, second ? second.id + 1 : null];
    out.lookaheadOpening = [look.id + 1, look.second ? look.second.id + 1 : null];
  }
  return out;
}

// Fleiss' kappa for positions rated by any number of reviewers (two or more each): mean pairwise agreement against
// the agreement expected from how often each corner number was chosen overall. Equals Fleiss (1971) when every
// position has the same number of ratings.
export function fleissKappa(items) {
  const rated = items.filter(x => x.length >= 2), totals = new Map();
  let sum = 0, all = 0;
  for (const labels of rated) {
    const counts = new Map();
    for (const c of labels) counts.set(c, (counts.get(c) || 0) + 1);
    let squares = 0;
    for (const [c, k] of counts) { squares += k * k; totals.set(c, (totals.get(c) || 0) + k); }
    sum += (squares - labels.length) / (labels.length * (labels.length - 1));
    all += labels.length;
  }
  if (!rated.length) return { items: 0, observed: null, expected: null, kappa: null };
  const observed = sum / rated.length, expected = [...totals.values()].reduce((s, k) => s + (k / all) ** 2, 0);
  return { items: rated.length, observed, expected, kappa: expected < 1 ? (observed - expected) / (1 - expected) : null };
}

const accepted = r => new Set([r.choice, ...r.acceptable]);

export function summarize({ positions, files, choices }) {
  const zero = () => ({ classic: 0, lookahead: 0, pips: 0 });
  const rows = positions.map(p => ({ p, c: choices[p.id], ratings: files.flatMap(f => f.ratings.filter(r => r.position === p.id).map(r => ({ ...r, who: f.label }))) }));
  for (const row of rows) {
    const votes = new Map();
    for (const r of row.ratings) for (const n of accepted(r)) votes.set(n, (votes.get(n) || 0) + 1);
    row.panel = [...votes].filter(([, k]) => k >= row.ratings.length / 2).map(([n]) => n).sort((a, b) => a - b);   // accepted by at least half
  }
  const top = zero(), acc = zero(), panel = { positions: 0, ...zero() }, openings = { rated: 0, classic: 0, lookahead: 0 };
  let ratings = 0, chance = 0, jaccard = 0, jaccardItems = 0;
  for (const { c, ratings: rs, panel: set } of rows) {
    for (const r of rs) {
      ratings++; chance += 1 / c.open;
      for (const k of POLICIES) { if (r.choice === c[k]) top[k]++; if (accepted(r).has(c[k])) acc[k]++; }
      if (r.plannedSecond !== null && c.classicOpening) {
        openings.rated++;
        for (const k of ['classic', 'lookahead']) if (r.choice === c[`${k}Opening`][0] && r.plannedSecond === c[`${k}Opening`][1]) openings[k]++;
      }
    }
    if (rs.length < 2) continue;
    panel.positions++;
    for (const k of POLICIES) if (set.includes(c[k])) panel[k]++;
    let sum = 0, pairs = 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = accepted(rs[i]), b = accepted(rs[j]), both = [...a].filter(n => b.has(n)).length;
      sum += both / (a.size + b.size - both); pairs++;
    }
    jaccard += sum / pairs; jaccardItems++;
  }
  const k = fleissKappa(rows.map(row => row.ratings.map(r => r.choice)));
  const pairs = [];
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    const a = new Map(files[i].ratings.map(r => [r.position, r.choice])), b = new Map(files[j].ratings.map(r => [r.position, r.choice]));
    const shared = [...a.keys()].filter(id => b.has(id));
    pairs.push({ a: files[i].label, b: files[j].label, shared: shared.length, agree: shared.filter(id => a.get(id) === b.get(id)).length });
  }
  const seats = [...new Set(positions.map(p => p.seat))].sort((a, b) => a - b);
  const groups = [
    ['same', 'Policies choose the same corner', row => row.c.classic === row.c.lookahead],
    ['different', 'Policies choose different corners', row => row.c.classic !== row.c.lookahead],
    ...seats.map(s => [`seat-${s}`, `Seat ${s}`, row => row.p.seat === s]),
    ['first', 'First settlement tasks', row => row.p.task === 'first'],
    ['second', 'Second settlement tasks', row => row.p.task === 'second'],
  ].map(([key, label, test]) => {
    const g = { key, label, positions: 0, ratings: 0, classicTop: 0, lookaheadTop: 0, classicAccepted: 0, lookaheadAccepted: 0 };
    for (const row of rows.filter(test)) {
      if (row.ratings.length) g.positions++;
      for (const r of row.ratings) {
        g.ratings++;
        if (r.choice === row.c.classic) g.classicTop++;
        if (r.choice === row.c.lookahead) g.lookaheadTop++;
        if (accepted(r).has(row.c.classic)) g.classicAccepted++;
        if (accepted(r).has(row.c.lookahead)) g.lookaheadAccepted++;
      }
    }
    return g;
  });
  const reviewers = files.map(f => {
    const sure = f.ratings.map(r => r.confidence).filter(x => x !== null), hits = k => f.ratings.filter(r => r.choice === choices[r.position][k]).length;
    return { label: f.label, ratings: f.ratings.length, classicTop: hits('classic'), lookaheadTop: hits('lookahead'), pipsTop: hits('pips'),
      meanConfidence: sure.length ? sure.reduce((s, x) => s + x, 0) / sure.length : null };
  });
  const byPosition = rows.map(({ p, c, ratings: rs, panel: set }) => {
    const chosen = {};
    for (const r of rs) chosen[r.choice] = (chosen[r.choice] || 0) + 1;
    return { id: p.id, seat: p.seat, task: p.task, ratings: rs.length, chosen, panel: set, classic: c.classic, lookahead: c.lookahead, pips: c.pips };
  });
  return { synthetic: files.some(f => f.synthetic), ratings, positionsRated: rows.filter(r => r.ratings.length).length, top, accepted: acc,
    chance: ratings ? chance / ratings : null, panel, openings,
    between: { items: k.items, pairwise: k.observed, kappa: k.kappa, expected: k.expected, jaccard: jaccardItems ? jaccard / jaccardItems : null, pairs },
    groups, reviewers, byPosition };
}

// ---- Plain-text report -------------------------------------------------------------------------------------------
const pct = (a, n) => (n ? `${(100 * a / n).toFixed(1)}% (${a} of ${n})` : 'n/a');
const num = (x, digits = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(digits));
function table(head, rows) {
  const all = [head, ...rows].map(r => r.map(String)), width = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  return all.map(r => '  ' + r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd()).join('\n');
}

export function report({ data, files, results: s, provenance }) {
  const out = [];
  if (s.synthetic) out.push(BANNER, '');
  out.push('Catan Lens expert review: analysis',
    `Positions: ${data.version} (${data.positions.length}). Answer files: ${files.length}. Reviewers: ${files.map(f => f.label).join(', ')}.`,
    `Ratings counted: ${s.ratings} on ${s.positionsRated} positions. Problems in the files: ${files.reduce((n, f) => n + f.problems.length, 0)} (listed at the end).`, '',
    'How to read this',
    '  Agreement with expert reviewers is one source of evidence, not proof that any choice is best. Reviewers can',
    '  share blind spots, and a policy can be right where reviewers disagree.',
    '  Ratings share reviewers and positions, so they are not independent. These are descriptive counts; no',
    '  significance test is reported. The planned comparison is described in study/README.md.',
    '  Each policy\'s choice was worked out now, by the code hashed at the end, after the answers were collected.', '',
    'Agreement with each policy',
    table(['Measure', 'Classic', 'Look-ahead', 'Most pips (baseline)'], [
      ['Reviewer\'s top choice is the policy\'s choice', ...POLICIES.map(k => pct(s.top[k], s.ratings))],
      ['Policy\'s choice is one the reviewer accepts', ...POLICIES.map(k => pct(s.accepted[k], s.ratings))],
      ['Policy\'s choice is in the panel set (positions)', ...POLICIES.map(k => pct(s.panel[k], s.panel.positions))],
      ['Planned opening matches (first settlement tasks)', pct(s.openings.classic, s.openings.rated), pct(s.openings.lookahead, s.openings.rated), 'n/a'],
    ]),
    `  A corner picked at random from the open ones would match a reviewer's top choice ${s.chance === null ? 'n/a' : (100 * s.chance).toFixed(1) + '%'} of the time.`,
    '  The panel set of a position is every corner accepted by at least half of its reviewers (two or more reviewers needed).', '',
    'Agreement between reviewers',
    `  Same top choice, share of reviewer pairs averaged over ${s.between.items} positions: ${s.between.pairwise === null ? 'n/a' : (100 * s.between.pairwise).toFixed(1) + '%'}`,
    `  Fleiss' kappa on the top choice: ${num(s.between.kappa, 3)} (0 is chance level, 1 is full agreement; chance agreement here ${s.between.expected === null ? 'n/a' : (100 * s.between.expected).toFixed(1) + '%'})`,
    `  Overlap of accepted corners between two reviewers (Jaccard, 0 to 1), averaged: ${num(s.between.jaccard)}`,
    ...s.between.pairs.map(x => `  ${x.a} and ${x.b}: same top choice on ${pct(x.agree, x.shared)} shared positions`), '',
    'By position type',
    table(['Group', 'Positions', 'Ratings', 'Top is classic', 'Top is look-ahead', 'Accepts classic', 'Accepts look-ahead'],
      s.groups.map(g => [g.label, g.positions, g.ratings, pct(g.classicTop, g.ratings), pct(g.lookaheadTop, g.ratings), pct(g.classicAccepted, g.ratings), pct(g.lookaheadAccepted, g.ratings)])), '',
    'By reviewer',
    table(['Reviewer', 'Ratings', 'Top is classic', 'Top is look-ahead', 'Top is most pips', 'Mean confidence'],
      s.reviewers.map(r => [r.label, r.ratings, pct(r.classicTop, r.ratings), pct(r.lookaheadTop, r.ratings), pct(r.pipsTop, r.ratings), num(r.meanConfidence, 1)])), '',
    'By position (corner numbers as on the review page)',
    table(['Position', 'Seat', 'Task', 'Ratings', 'Chosen (times)', 'Panel set', 'Classic', 'Look-ahead', 'Most pips'],
      s.byPosition.map(p => [p.id, p.seat, p.task, p.ratings, Object.entries(p.chosen).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([n, k]) => `${n} (${k})`).join(', ') || 'none',
        p.panel.join(', ') || 'none', p.classic, p.lookahead, p.pips])), '',
    'Problems in the answer files',
    ...(files.some(f => f.problems.length) ? files.flatMap(f => f.problems.map(x => `  ${x}`)) : ['  none']), '',
    `Code used: look-ahead policy ${provenance.lookaheadPolicy}; sha256 ${Object.entries(provenance.files).map(([f, h]) => `${f} ${h.slice(0, 12)}`).join(', ')}.`);
  if (s.synthetic) out.push('', BANNER);
  return out.join('\n') + '\n';
}

function provenance() {
  const root = new URL('..', import.meta.url);
  return { lookaheadPolicy: POLICY, files: Object.fromEntries(CODE.map(f => [f, createHash('sha256').update(readFileSync(new URL(f, root))).digest('hex')])) };
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { positions: { type: 'string' }, json: { type: 'string' } } });
  if (!positionals.length) throw new Error('Usage: node study/analyze.mjs [--positions file.json] [--json results.json] answers.json [more.json ...]');
  const data = JSON.parse(readFileSync(values.positions || new URL('./positions-2026-10-12.json', import.meta.url), 'utf8'));
  const files = positionals.map(f => readAnswers(JSON.parse(readFileSync(f, 'utf8')), data, basename(f)));
  checkMix(files);
  const labels = files.map(f => f.label), repeated = labels.filter((x, i) => labels.indexOf(x) !== i);
  if (repeated.length) throw new Error(`More than one file for reviewer ${[...new Set(repeated)].join(', ')}. Keep one file per reviewer (the latest download holds everything).`);
  const choices = Object.fromEntries(data.positions.map(p => [p.id, policyChoices(p)]));
  const results = summarize({ positions: data.positions, files, choices }), code = provenance();
  process.stdout.write(report({ data, files, results, provenance: code }));
  if (values.json) writeFileSync(values.json, JSON.stringify({ kind: 'catan-lens-study-analysis', positions: data.version, synthetic: results.synthetic,
    note: results.synthetic ? BANNER : undefined, caveat: 'Agreement with expert reviewers is one source of evidence, not proof that any choice is best.',
    files: files.map(f => ({ label: f.label, ratings: f.ratings.length, problems: f.problems })), code, results }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

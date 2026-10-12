"""The look-ahead (draft-aware) benchmark: predeclared plan, timing pilot, resumable runs and the report.

    python3 bench/catanatron/draft_aware.py plan            # once, before any game: freezes inputs and the analysis
    python3 bench/catanatron/draft_aware.py pilot           # timing only; win rates are not printed
    python3 bench/catanatron/draft_aware.py run [--parallel N]   # 20 clusters x 400 boards x every arm, resumable
    python3 bench/catanatron/draft_aware.py report          # archive + report from the finished runs

Use the Python environment pinned in evidence/requirements-2026-10-09.txt (Catanatron at the commit in
requirements.txt). Runs refuse to start if any frozen input differs from the plan. Standard library only, apart
from Catanatron inside catanatron_bench.py.
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import platform
import statistics
import subprocess
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EVIDENCE = HERE / 'evidence'
PLAN = EVIDENCE / 'draft-aware-plan-2026-10-12.json'
REPORT = EVIDENCE / 'draft-aware-2026-10-12.json'
ARCHIVE = EVIDENCE / 'draft-aware-2026-10-12.jsonl.gz'
RUNS = ROOT / 'draft-aware-output'          # working directory for raw runs (not committed)
ARMS = ['lens-draft', 'lens', 'value', 'pips']
LABELS = {'lens-draft': 'Catan Lens look-ahead (experimental) settlements and road', 'lens': 'Catan Lens classic settlements and road',
          'value': "The bot's own opening", 'pips': 'Most pips'}
HASH_SEEDS = list(range(401, 421))
BOARD_START, GAMES_PER_RUN = 4000000, 400
PILOT = {'hashSeed': 499, 'boardStart': 4900000, 'gamesPerArm': 40}
COMPARISONS = [('lens-draft', 'lens', 'primary'), ('lens-draft', 'value', 'secondary'), ('lens-draft', 'pips', 'descriptive')]
FROZEN = ['package.json', 'public/board.js', 'public/geometry.js', 'public/score.js', 'public/lookahead.js', 'bench/lens-bridge.mjs',
          'bench/catanatron/catanatron_bench.py', 'bench/catanatron/requirements.txt', 'bench/catanatron/draft_aware.py']
T19 = 2.093024054408263   # two-sided 95% Student t, 19 degrees of freedom
FIELDS = {'arm', 'finished', 'hashseed', 'seat', 'seed', 'turns', 'vp', 'win', 'openings', 'projection'}


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def manifest():
    return {f: sha(f) for f in FROZEN}


def interval(rates):
    return 100 * statistics.mean(rates), 100 * T19 * statistics.stdev(rates) / math.sqrt(len(rates))


def mcnemar_exact(a, b):
    from fractions import Fraction
    n = a + b
    if n == 0:
        return Fraction(1)
    return min(Fraction(1), Fraction(2 * sum(math.comb(n, i) for i in range(min(a, b) + 1)), 2 ** n))


def cmd_plan(args):
    if PLAN.exists():
        sys.exit(f'{PLAN.name} exists: a plan is declared once, before its games.')
    dirty = subprocess.run(['git', 'status', '--porcelain', '--', *FROZEN], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if dirty:
        sys.exit('Frozen inputs have uncommitted changes; commit them first:\n' + dirty)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    plan = {
        'predeclaredAt': datetime.now(timezone.utc).isoformat(),
        'purpose': args.purpose,
        'sourceCommit': commit,
        'files': manifest(),
        'arms': ARMS,
        'armLabels': LABELS,
        'hashSeeds': HASH_SEEDS,
        'boardSeeds': [BOARD_START, BOARD_START + len(HASH_SEEDS) * GAMES_PER_RUN - 1],
        'gamesPerArm': len(HASH_SEEDS) * GAMES_PER_RUN,
        'totalGames': len(HASH_SEEDS) * GAMES_PER_RUN * len(ARMS),
        'pilot': PILOT,
        'comparisons': [{'comparison': f'{a}-minus-{b}', 'role': role} for a, b, role in COMPARISONS],
        'analysis': args.analysis,
        'decisionRule': args.decision,
        'environment': {'python': platform.python_version(), 'requirements': 'requirements-2026-10-09.txt'},
    }
    PLAN.write_text(json.dumps(plan, indent=1) + '\n')
    print(f'Declared {PLAN.name} at {plan["predeclaredAt"]} for commit {commit[:9]}. Commit this file before any game.')


def check_frozen():
    plan = json.loads(PLAN.read_text())
    drift = [f for f, h in plan['files'].items() if sha(f) != h]
    if drift:
        sys.exit('Frozen inputs changed since the plan: ' + ', '.join(drift))
    return plan


def bench(hashseed, start, games, out):
    env = {**os.environ, 'PYTHONHASHSEED': str(hashseed), 'LENS_LOG_OPENINGS': '1'}
    subprocess.run([sys.executable, str(HERE / 'catanatron_bench.py'), '--games', str(games), '--start', str(start), '--jobs', '4',
                    '--arms', ','.join(ARMS), '--out', str(out)], env=env, check=True, stdout=subprocess.DEVNULL)


def cmd_pilot(args):
    check_frozen()
    RUNS.mkdir(exist_ok=True)
    out = RUNS / 'pilot.jsonl'
    began = time.monotonic()
    bench(PILOT['hashSeed'], PILOT['boardStart'], PILOT['gamesPerArm'], out)
    seconds = time.monotonic() - began
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    per_game = seconds / len(rows)
    total = len(HASH_SEEDS) * GAMES_PER_RUN * len(ARMS)
    print(f'Pilot: {len(rows)} games ({PILOT["gamesPerArm"]} per arm, 4 workers) in {seconds:.1f} s, {per_game:.3f} s per game.')
    print(f'Projected full run: {total:,} games, about {total * per_game / 60:.0f} minutes at one run at a time; '
          f'divide by --parallel. Unfinished pilot games: {sum(not r["finished"] for r in rows)}. Win rates are not shown.')


def cmd_run(args):
    check_frozen()
    RUNS.mkdir(exist_ok=True)

    def one(index):
        h = HASH_SEEDS[index]
        out = RUNS / f'run-{h}.jsonl'
        want = GAMES_PER_RUN * len(ARMS)
        if out.exists() and len(out.read_text().splitlines()) == want:
            return f'run {h} already complete'
        bench(h, BOARD_START + index * GAMES_PER_RUN, GAMES_PER_RUN, out)
        return f'run {h} done ({datetime.now().strftime("%H:%M:%S")})'

    with ThreadPoolExecutor(args.parallel) as pool:
        for line in pool.map(one, range(len(HASH_SEEDS))):
            print(line, flush=True)


def load_runs():
    rows = []
    for h in HASH_SEEDS:
        rows += [json.loads(line) for line in (RUNS / f'run-{h}.jsonl').read_text().splitlines()]
    return rows


def analyse(rows):
    """Everything the report publishes, recomputed from raw rows (shared with the verifier)."""
    seen, boards, groups = set(), defaultdict(dict), defaultdict(list)
    for r in rows:
        assert set(r) == FIELDS, sorted(r)
        h = int(r['hashseed'])
        assert h in HASH_SEEDS and r['arm'] in ARMS
        lo = BOARD_START + HASH_SEEDS.index(h) * GAMES_PER_RUN
        assert type(r['seed']) is int and lo <= r['seed'] < lo + GAMES_PER_RUN
        assert r['seat'] in (1, 2, 3, 4) and type(r['win']) is bool and type(r['finished']) is bool
        assert not r['win'] or r['vp'] >= 10
        key = (h, r['seed'], r['arm'])
        assert key not in seen
        seen.add(key)
        boards[(h, r['seed'])][r['arm']] = r
        groups[(h, r['arm'])].append(int(r['win']))
    assert len(boards) == len(HASH_SEEDS) * GAMES_PER_RUN
    for b in boards.values():
        assert set(b) == set(ARMS) and len({x['seat'] for x in b.values()}) == 1
    out = {'unfinished': sum(not r['finished'] for r in rows), 'clusters': [], 'unroundedSummary': {}, 'arms': [],
           'pairedDifferences': {}, 'exactTests': {}, 'recordChanges': {}}
    for h in HASH_SEEDS:
        out['clusters'].append({'hashseed': str(h), 'gamesPerArm': GAMES_PER_RUN, 'wins': {a: sum(groups[(h, a)]) for a in ARMS}})
    rates = {a: [statistics.mean(groups[(h, a)]) for h in HASH_SEEDS] for a in ARMS}
    for a in ARMS:
        mean, half = interval(rates[a])
        wins = sum(sum(groups[(h, a)]) for h in HASH_SEEDS)
        games = len(HASH_SEEDS) * GAMES_PER_RUN
        out['unroundedSummary'][a] = {'meanPercent': mean, 'ci95HalfWidthPP': half, 'ci95Lower': mean - half, 'ci95Upper': mean + half,
                                      'wins': wins, 'games': games, 'runs': len(HASH_SEEDS)}
        out['arms'].append({'key': a, 'label': LABELS[a], 'win': float((Decimal(wins) * 100 / games).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)),
                            'ci': float(Decimal(str(half)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)), 'wins': wins, 'games': games, 'runs': len(HASH_SEEDS)})
    for a, b, role in COMPARISONS:
        name = f'{a}-minus-{b}'
        mean, half = interval([x - y for x, y in zip(rates[a], rates[b])])
        out['pairedDifferences'][name] = {'role': role, 'differencePP': mean, 'lower95PP': mean - half, 'upper95PP': mean + half}
        to_a = sum(1 for x in boards.values() if x[a]['win'] and not x[b]['win'])
        to_b = sum(1 for x in boards.values() if x[b]['win'] and not x[a]['win'])
        p = mcnemar_exact(to_a, to_b)
        out['exactTests'][name] = {'changedPairs': to_a + to_b, 'favoursFirst': to_a, 'favoursSecond': to_b, 'pExact': [str(p.numerator), str(p.denominator)],
                                   'pValue': float(f'{float(p):.6g}'), 'governs': 'exact test' if to_a + to_b < 100 else 'both must agree'}
        out['recordChanges'][name] = {'winChanged': to_a + to_b, 'recordedOutcomeChanged': sum(1 for x in boards.values() if any(x[a][k] != x[b][k] for k in ('win', 'vp', 'turns')))}
    out['subjectSeatCounts'] = dict(sorted(Counter(str(b['lens']['seat']) for b in boards.values()).items()))
    # How often the look-ahead's first settlement differs from the classic one on the same board and seat.
    first = lambda r: next(v for s, v in r['openings'] if s == r['seat'])
    out['firstPickDiffers'] = {'boards': len(boards), 'differ': sum(1 for b in boards.values() if first(b['lens-draft']) != first(b['lens']))}
    # Projection accuracy (descriptive): at its first settlement the look-ahead projected every later pick; how often did
    # the bots actually take the projected corner? Slots are in snake order, so placement i is slot i.
    order = [1, 2, 3, 4, 4, 3, 2, 1]
    hits, total, by_gap = 0, 0, defaultdict(lambda: [0, 0])
    own_second = [0, 0]
    for b in boards.values():
        r = b['lens-draft']
        assert [s for s, _ in r['openings']] == order and len(r['projection']) == 8
        mine = order.index(r['seat'])
        for i, (d, (seat, vertex)) in enumerate(zip(r['projection'], r['openings'])):
            assert d['seat'] == seat
            if d['actual']:
                continue
            if seat == r['seat']:
                own_second[0] += int(d['id'] == vertex); own_second[1] += 1
                continue
            hit = int(d['id'] == vertex)
            hits += hit; total += 1
            by_gap[i - mine][0] += hit; by_gap[i - mine][1] += 1
    out['projectionAccuracy'] = {'otherSeatPicks': total, 'matched': hits, 'bySlotsAfterFirstPick': {str(k): {'matched': v[0], 'picks': v[1]} for k, v in sorted(by_gap.items())},
                                 'ownSecondMatched': own_second[0], 'ownSecondProjected': own_second[1]}
    return out


def cmd_report(args):
    plan = check_frozen()
    rows = load_runs()
    assert len(rows) == plan['totalGames']
    result = analyse(rows)
    normalized = sorted(rows, key=lambda r: (int(r['hashseed']), r['seed'], ARMS.index(r['arm'])))
    raw = ''.join(json.dumps(r, sort_keys=True) + '\n' for r in normalized).encode()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    ARCHIVE.write_bytes(compressed)
    report = {
        'date': '2026-10-12', 'policy': 'draft-aware-2026-10-12', 'predeclaredAt': plan['predeclaredAt'], 'sourceCommit': plan['sourceCommit'],
        'files': plan['files'], 'hashSeeds': [HASH_SEEDS[0], HASH_SEEDS[-1]], 'boardSeeds': plan['boardSeeds'], 'games': plan['gamesPerArm'],
        'runs': len(HASH_SEEDS), 'totalGames': len(rows), **result,
        'rawData': {'file': ARCHIVE.name, 'gzipSha256': hashlib.sha256(compressed).hexdigest(), 'jsonlSha256': hashlib.sha256(raw).hexdigest(),
                    'records': len(rows), 'normalization': 'Sorted by hash seed, board seed and arm order; JSON keys sorted.'},
        'method': f'Predeclared two-sided approximate 95% Student t intervals over 20 cluster means, df 19, t={T19}. Paired differences subtract arms '
                  'within each cluster (percentage points). Exact two-sided McNemar tests on changed win/loss pairs; the exact test governs when fewer '
                  'than 100 pairs change, otherwise a conclusion must agree with both.',
        'rounding': 'Displayed win rates use decimal half-up rounding to one decimal from exact win counts. Inference uses unrounded cluster means.',
        'environment': plan['environment'],
    }
    REPORT.write_text(json.dumps(report, indent=1) + '\n')
    print(f'Wrote {ARCHIVE.name} ({len(compressed):,} bytes) and {REPORT.name}.')
    for a in result['arms']:
        print(f"{a['label']:58} {a['wins']:>5}/{a['games']}  {a['win']:4.1f}% +/- {a['ci']}")
    for name, d in result['pairedDifferences'].items():
        e = result['exactTests'][name]
        print(f"{name:24} {d['differencePP']:+.4f} pp ({d['lower95PP']:+.4f} to {d['upper95PP']:+.4f}); changed pairs {e['favoursFirst']}/{e['favoursSecond']}, exact p = {e['pValue']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--purpose', required=True)
    p.add_argument('--analysis', required=True)
    p.add_argument('--decision', required=True)
    sub.add_parser('pilot')
    r = sub.add_parser('run')
    r.add_argument('--parallel', type=int, default=1)
    sub.add_parser('report')
    args = parser.parse_args()
    {'plan': cmd_plan, 'pilot': cmd_pilot, 'run': cmd_run, 'report': cmd_report}[args.cmd](args)


if __name__ == '__main__':
    main()

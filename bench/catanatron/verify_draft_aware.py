"""Check the 2026-10-12 look-ahead benchmark's raw games and recompute every published figure with the standard library.

    python3 bench/catanatron/verify_draft_aware.py

Independent of draft_aware.py: it rereads the archive, checks both checksums and every row, then recomputes the win
counts, the cluster t intervals, the paired differences, the exact McNemar tests, the first-pick and projection
figures, and compares them with the report and with the key shown on the site (public/media/results.json).
"""
import argparse
import gzip
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARMS = ['lens-draft', 'lens', 'value', 'pips']
HASH_SEEDS = list(range(401, 421))
BOARD_START, PER_RUN = 4000000, 400
COMPARISONS = [('lens-draft', 'lens', 'primary'), ('lens-draft', 'value', 'secondary'), ('lens-draft', 'pips', 'descriptive')]
ORDER = [1, 2, 3, 4, 4, 3, 2, 1]
T19 = 2.093024054408263   # two-sided 95% Student t, 19 degrees of freedom


def interval(rates):
    mean = statistics.mean(rates)
    return 100 * mean, 100 * T19 * statistics.stdev(rates) / math.sqrt(len(rates))


def exact(a, b):
    n = a + b
    if n == 0:
        return Fraction(1)
    return min(Fraction(1), Fraction(2 * sum(math.comb(n, i) for i in range(min(a, b) + 1)), 2 ** n))


def tenth(x):
    return float(Decimal(str(x)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--evidence', type=Path, default=Path(__file__).resolve().parent / 'evidence')
    parser.add_argument('--results', type=Path, default=ROOT / 'public/media/results.json')
    args = parser.parse_args()
    plan = json.loads((args.evidence / 'draft-aware-plan-2026-10-12.json').read_text())
    report = json.loads((args.evidence / 'draft-aware-2026-10-12.json').read_text())

    # The report covers the plan declared before the games: the same commit, inputs, seeds and arms.
    for key in ('predeclaredAt', 'sourceCommit', 'files', 'boardSeeds'):
        assert report[key] == plan[key], key
    assert plan['arms'] == ARMS and plan['hashSeeds'] == HASH_SEEDS and plan['boardSeeds'] == [BOARD_START, BOARD_START + 20 * PER_RUN - 1]
    assert [c['comparison'] for c in plan['comparisons']] == [f'{a}-minus-{b}' for a, b, _ in COMPARISONS]

    compressed = (args.evidence / report['rawData']['file']).read_bytes()
    assert hashlib.sha256(compressed).hexdigest() == report['rawData']['gzipSha256'], 'archive checksum'
    raw = gzip.decompress(compressed)
    assert hashlib.sha256(raw).hexdigest() == report['rawData']['jsonlSha256'], 'records checksum'
    rows = [json.loads(line) for line in raw.splitlines()]
    assert len(rows) == report['totalGames'] == report['rawData']['records'] == 32000

    seen, boards, groups = set(), defaultdict(dict), defaultdict(list)
    for row in rows:
        assert set(row) == {'arm', 'finished', 'hashseed', 'seat', 'seed', 'turns', 'vp', 'win', 'openings', 'projection'}, sorted(row)
        h, arm = int(row['hashseed']), row['arm']
        assert h in HASH_SEEDS and arm in ARMS
        lo = BOARD_START + (h - HASH_SEEDS[0]) * PER_RUN
        assert lo <= row['seed'] < lo + PER_RUN
        assert row['seat'] in (1, 2, 3, 4) and isinstance(row['win'], bool) and isinstance(row['finished'], bool)
        assert not row['win'] or row['vp'] >= 10
        assert [s for s, _ in row['openings']] == ORDER, 'eight opening settlements in snake order'
        assert (row['projection'] is not None) == (arm == 'lens-draft')
        key = (h, row['seed'], arm)
        assert key not in seen
        seen.add(key)
        boards[key[:2]][arm] = row
        groups[(h, arm)].append(int(row['win']))
    assert len(boards) == 8000
    for board in boards.values():
        assert set(board) == set(ARMS) and len({r['seat'] for r in board.values()}) == 1, 'every arm plays the same seat'
    assert report['unfinished'] == sum(not r['finished'] for r in rows)
    assert report['subjectSeatCounts'] == dict(sorted(Counter(str(b['lens']['seat']) for b in boards.values()).items()))

    for cluster in report['clusters']:
        for arm in ARMS:
            group = groups[(int(cluster['hashseed']), arm)]
            assert len(group) == cluster['gamesPerArm'] == PER_RUN and sum(group) == cluster['wins'][arm]
    rates = {arm: [statistics.mean(groups[(h, arm)]) for h in HASH_SEEDS] for arm in ARMS}
    for published in report['arms']:
        arm = published['key']
        wins = sum(sum(groups[(h, arm)]) for h in HASH_SEEDS)
        mean, half = interval(rates[arm])
        assert published['wins'] == wins and published['games'] == 8000 and published['runs'] == 20
        assert published['win'] == float((Decimal(wins) * 100 / 8000).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
        assert published['ci'] == tenth(half)
        assert math.isclose(mean, report['unroundedSummary'][arm]['meanPercent'], abs_tol=1e-10)
        assert math.isclose(half, report['unroundedSummary'][arm]['ci95HalfWidthPP'], abs_tol=1e-10)
    assert [a['key'] for a in report['arms']] == ARMS

    for a, b, role in COMPARISONS:
        name = f'{a}-minus-{b}'
        mean, half = interval([x - y for x, y in zip(rates[a], rates[b])])
        published = report['pairedDifferences'][name]
        assert published['role'] == role
        for actual, field in [(mean, 'differencePP'), (mean - half, 'lower95PP'), (mean + half, 'upper95PP')]:
            assert math.isclose(actual, published[field], abs_tol=1e-10), (name, field)
        to_a = sum(1 for x in boards.values() if x[a]['win'] and not x[b]['win'])
        to_b = sum(1 for x in boards.values() if x[b]['win'] and not x[a]['win'])
        p = exact(to_a, to_b)
        test = report['exactTests'][name]
        assert (test['changedPairs'], test['favoursFirst'], test['favoursSecond']) == (to_a + to_b, to_a, to_b)
        assert Fraction(int(test['pExact'][0]), int(test['pExact'][1])) == p and test['pValue'] == float(f'{float(p):.6g}')
        print(f'{name}: {mean:+.4f} percentage points (95% interval {mean - half:+.4f} to {mean + half:+.4f}); '
              f'changed pairs {to_a}/{to_b}, exact p = {float(p):.6g}')

    def first(r):
        return next(v for s, v in r['openings'] if s == r['seat'])
    assert report['firstPickDiffers'] == {'boards': 8000, 'differ': sum(1 for x in boards.values() if first(x['lens-draft']) != first(x['lens']))}
    hits = total = own_hits = own_total = 0
    for x in boards.values():
        r = x['lens-draft']
        assert [d['seat'] for d in r['projection']] == ORDER
        for d, (seat, vertex) in zip(r['projection'], r['openings']):
            if d['actual']:
                continue
            if seat == r['seat']:
                own_hits += d['id'] == vertex
                own_total += 1
            else:
                hits += d['id'] == vertex
                total += 1
    accuracy = report['projectionAccuracy']
    assert (accuracy['matched'], accuracy['otherSeatPicks'], accuracy['ownSecondMatched'], accuracy['ownSecondProjected']) == (hits, total, own_hits, own_total)

    public = json.loads(args.results.read_text())['draftAware']
    assert public['arms'] == report['arms'] and public['pairedDifferences'] == report['pairedDifferences']
    assert public['exactTests'] == report['exactTests']
    print(f"Verified 32,000 complete games, 8,000 paired boards, 20 clusters, both checksums and the displayed results. "
          f"First pick differs on {report['firstPickDiffers']['differ']:,} of 8,000 boards; the projection matched {hits:,} of {total:,} other-seat picks.")


if __name__ == '__main__':
    main()

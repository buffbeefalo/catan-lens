"""Check the published 2026-10-09 raw games and recompute their intervals with Python's standard library."""
import gzip
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


def interval(rates):
    mean = statistics.mean(rates)
    half = 2.093024054408263 * statistics.stdev(rates) / math.sqrt(len(rates))
    return 100 * mean, 100 * half


def main():
    evidence = Path(__file__).parent / 'evidence'
    report = json.loads((evidence / 'holdout-2026-10-09.json').read_text())
    compressed = (evidence / report['rawData']['file']).read_bytes()
    assert hashlib.sha256(compressed).hexdigest() == report['rawData']['gzipSha256']
    raw = gzip.decompress(compressed)
    assert hashlib.sha256(raw).hexdigest() == report['rawData']['jsonlSha256']
    rows = list(map(json.loads, raw.splitlines()))
    assert len(rows) == report['totalGames'] == report['rawData']['records'] == 40000
    arms = {arm['key'] for arm in report['arms']}
    assert arms == {'lens', 'lens-sett', 'value', 'pips', 'random'}
    groups, boards, seen = defaultdict(list), defaultdict(dict), set()
    for row in rows:
        assert set(row) == {'arm', 'finished', 'hashseed', 'seat', 'seed', 'turns', 'vp', 'win'}
        seed, arm = int(row['hashseed']), row['arm']
        assert 101 <= seed <= 120 and arm in arms
        assert 1000000 + (seed - 101) * 400 <= row['seed'] < 1000000 + (seed - 100) * 400
        assert row['seat'] in [1, 2, 3, 4] and isinstance(row['win'], bool)
        assert row['finished'] is True
        assert not row['win'] or row['vp'] >= 10
        key = seed, row['seed'], arm
        assert key not in seen
        seen.add(key)
        groups[(seed, arm)].append(int(row['win']))
        boards[key[:2]][arm] = row['seat']
    assert len(boards) == 8000
    for board in boards.values():
        assert set(board) == arms and len(set(board.values())) == 1
    seats = Counter(str(board['lens']) for board in boards.values())
    assert dict(seats) == report['subjectSeatCounts']
    for cluster in report['clusters']:
        for arm in arms:
            group = groups[(int(cluster['hashseed']), arm)]
            assert len(group) == cluster['gamesPerArm'] == 400
            assert sum(group) == cluster['wins'][arm]
    rates = {arm: [statistics.mean(groups[(seed, arm)]) for seed in range(101, 121)] for arm in arms}
    for published in report['arms']:
        arm = published['key']
        mean, half = interval(rates[arm])
        wins = sum(sum(groups[(seed, arm)]) for seed in range(101, 121))
        assert published['games'] == 8000 and published['wins'] == wins and published['runs'] == 20
        rounded = (Decimal(wins) * 100 / 8000).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
        assert published['win'] == float(rounded)
        assert published['ci'] == float(Decimal(str(half)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
        assert math.isclose(mean, report['unroundedSummary'][arm]['meanPercent'], abs_tol=1e-10)
        assert math.isclose(half, report['unroundedSummary'][arm]['ci95HalfWidthPP'], abs_tol=1e-10)
    for other in ['value', 'pips']:
        mean, half = interval([a - b for a, b in zip(rates['lens'], rates[other])])
        published = report['pairedDifferences']['lens-minus-' + other]
        for actual, name in [(mean, 'differencePP'), (mean - half, 'lower95PP'), (mean + half, 'upper95PP')]:
            assert math.isclose(actual, published[name], abs_tol=1e-10)
        print(f'Lens minus {other}: {mean:.4f} percentage points; 95% interval {mean-half:.4f} to {mean+half:.4f}')
    public = json.loads((Path(__file__).resolve().parents[2] / 'public/media/results.json').read_text())['holdout']
    assert public['arms'] == report['arms'] and public['pairedDifferences'] == report['pairedDifferences']
    print('Verified 40,000 complete games, 8,000 paired boards, 20 clusters, all checksums and displayed results.')


if __name__ == '__main__':
    main()

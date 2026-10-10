"""Recompute the separately frozen owned-harbour comparison from its public raw games."""
import argparse
import gzip
import hashlib
import json
import math
import statistics
import subprocess
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from verify_holdout import interval


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', action='store_true', help='also check all frozen git blobs; requires full repository history')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    evidence = Path(__file__).parent / 'evidence'
    report = json.loads((evidence / 'owned-harbour-2026-10-09.json').read_text())
    plan = json.loads((evidence / 'owned-harbour-plan-2026-10-09.json').read_text())
    assert report['predeclaredAt'] == plan['predeclaredAt']
    assert report['hashSeeds'] == [201, 220] and plan['hashSeeds'] == list(range(201, 221))
    assert report['boardSeeds'] == plan['boardSeeds'] == [2000000, 2007999]
    assert report['primaryComparison'] == 'corrected-minus-lens-before'
    snapshots = report['inputSnapshots']
    assert snapshots['baseline']['sourceCommit'] == report['baselineCommit'] == plan['baselineCommit']
    assert snapshots['candidate']['sourceCommit'] == report['sourceCommit']
    old, new = snapshots['baseline']['files'], snapshots['candidate']['files']
    assert set(old) == set(new) and len(old) == 9
    assert [name for name in old if old[name] != new[name]] == ['public/score.js']
    if args.sources:
        for snapshot in snapshots.values():
            for name, wanted in snapshot['files'].items():
                blob = subprocess.check_output(['git', 'show', f"{snapshot['sourceCommit']}:{name}"], cwd=root)
                assert hashlib.sha256(blob).hexdigest() == wanted, name

    compressed = (evidence / report['rawData']['file']).read_bytes()
    assert hashlib.sha256(compressed).hexdigest() == report['rawData']['gzipSha256']
    raw = gzip.decompress(compressed)
    assert hashlib.sha256(raw).hexdigest() == report['rawData']['jsonlSha256']
    rows = list(map(json.loads, raw.splitlines()))
    assert len(rows) == report['totalGames'] == report['rawData']['records'] == plan['totalGames'] == 24000
    arms = {'lens-corrected', 'lens-before', 'value'}
    assert {arm['key'] for arm in report['arms']} == arms
    groups, boards, seen = defaultdict(list), defaultdict(dict), set()
    for row in rows:
        assert set(row) == {'arm', 'finished', 'hashseed', 'seat', 'seed', 'turns', 'vp', 'win'}
        seed, arm = int(row['hashseed']), row['arm']
        assert 201 <= seed <= 220 and arm in arms
        assert type(row['seed']) is int and 2000000 + (seed - 201) * 400 <= row['seed'] < 2000000 + (seed - 200) * 400
        assert type(row['seat']) is int and 1 <= row['seat'] <= 4
        assert type(row['win']) is bool and row['finished'] is True
        assert type(row['vp']) is int and row['vp'] >= 0
        assert type(row['turns']) is int and row['turns'] > 0
        assert not row['win'] or row['vp'] >= 10
        key = seed, row['seed'], arm
        assert key not in seen
        seen.add(key)
        groups[(seed, arm)].append(int(row['win']))
        boards[key[:2]][arm] = row
    assert len(boards) == 8000 and report['unfinished'] == 0
    changes = dict.fromkeys(['changedToWin', 'changedToLoss', 'winChanged', 'recordedOutcomeChanged'], 0)
    for board in boards.values():
        assert set(board) == arms and len({row['seat'] for row in board.values()}) == 1
        before, after = board['lens-before'], board['lens-corrected']
        changes['changedToWin'] += int(not before['win'] and after['win'])
        changes['changedToLoss'] += int(before['win'] and not after['win'])
        changes['winChanged'] += int(before['win'] != after['win'])
        changes['recordedOutcomeChanged'] += int(any(before[k] != after[k] for k in ['win', 'vp', 'turns']))
    assert changes == report['recordChanges']
    assert dict(Counter(str(b['value']['seat']) for b in boards.values())) == report['subjectSeatCounts']
    assert [int(c['hashseed']) for c in report['clusters']] == list(range(201, 221))
    for cluster in report['clusters']:
        assert set(cluster['wins']) == arms
        for arm in arms:
            group = groups[(int(cluster['hashseed']), arm)]
            assert len(group) == cluster['gamesPerArm'] == 400
            assert sum(group) == cluster['wins'][arm]
    rates = {arm: [statistics.mean(groups[(seed, arm)]) for seed in range(201, 221)] for arm in arms}
    for published in report['arms']:
        arm = published['key']
        mean, half = interval(rates[arm])
        wins = sum(sum(groups[(seed, arm)]) for seed in range(201, 221))
        assert published['games'] == plan['gamesPerArm'] == 8000 and published['wins'] == wins and published['runs'] == 20
        assert published['win'] == float((Decimal(wins) * 100 / 8000).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
        assert published['ci'] == float(Decimal(str(half)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
        assert math.isclose(mean, report['unroundedSummary'][arm]['meanPercent'], abs_tol=1e-10)
        assert math.isclose(half, report['unroundedSummary'][arm]['ci95HalfWidthPP'], abs_tol=1e-10)
        for actual, name in [(mean - half, 'ci95Lower'), (mean + half, 'ci95Upper')]:
            assert math.isclose(actual, report['unroundedSummary'][arm][name], abs_tol=1e-10)
        assert report['unroundedSummary'][arm]['wins'] == wins
        assert report['unroundedSummary'][arm]['games'] == 8000 and report['unroundedSummary'][arm]['runs'] == 20
    for other in ['lens-before', 'value']:
        mean, half = interval([a - b for a, b in zip(rates['lens-corrected'], rates[other])])
        published = report['pairedDifferences']['corrected-minus-' + other]
        for actual, name in [(mean, 'differencePP'), (mean - half, 'lower95PP'), (mean + half, 'upper95PP')]:
            assert math.isclose(actual, published[name], abs_tol=1e-10)
        print(f'Corrected minus {other}: {mean:.4f} percentage points; approximate 95% interval {mean-half:.4f} to {mean+half:.4f}')
    public = json.loads((root / 'public/media/results.json').read_text())['ownedHarbour']
    assert set(public) == {'date', 'policy', 'baselineCommit', 'sourceCommit', 'engineCommit', 'hashSeeds', 'boardSeeds',
                           'games', 'runs', 'totalGames', 'unfinished', 'arms', 'pairedDifferences', 'recordChanges'}
    for name, value in public.items():
        assert value == report[name], name
    print('Verified 24,000 complete games, 8,000 paired boards, 20 clusters, archive checksums and displayed results.')
    print(f"Changed win/loss pairs: {changes['winChanged']}; to win: {changes['changedToWin']}; to loss: {changes['changedToLoss']}.")


if __name__ == '__main__':
    main()

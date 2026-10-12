"""Exact McNemar tests for the archived paired benchmark comparisons (Python standard library only).

Two arms that played the same boards and seats form matched pairs. Only pairs whose win/loss outcome differs
carry information about a difference between the arms. Under the hypothesis of no difference, each changed
pair is equally likely to favour either arm, so the count favouring one arm follows Binomial(changed, 1/2).
The exact two-sided p-value doubles the smaller tail and caps it at 1.

    python3 bench/catanatron/exact_tests.py              # recompute every comparison from the raw archives
    python3 bench/catanatron/exact_tests.py --self-test  # known answers; no data needed
    python3 bench/catanatron/exact_tests.py --check      # recompute and compare with exact-tests.json

This test ignores the clustering by bot hash seed. It asks whether the changed pairs lean one way more than
chance would explain; the clustered t intervals published with each comparison estimate the size of a
difference. When few pairs change, the t interval over 20 cluster means is unreliable (most cluster
differences are exactly zero), and this exact test governs.
"""
import argparse
import gzip
import hashlib
import json
from fractions import Fraction
from math import comb
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / 'evidence'
SUMMARY = HERE / 'exact-tests.json'

# (archive, label, arm A, arm B, role). A minus B; "favours A" counts pairs where A won and B lost.
COMPARISONS = [
    ('holdout-2026-10-09', 'Fresh-seed test: Lens minus most pips', 'lens', 'pips', 'reported'),
    ('holdout-2026-10-09', "Fresh-seed test: Lens minus the bot's own opening", 'lens', 'value', 'reported'),
    ('owned-harbour-2026-10-09', 'Owned-harbour correction minus the previous policy', 'lens-corrected', 'lens-before', 'primary'),
    ('owned-harbour-2026-10-09', "Owned-harbour correction minus the bot's own opening", 'lens-corrected', 'value', 'descriptive'),
    ('reachable-harbour-2026-10-09', 'Reachability correction minus the previous policy', 'lens-corrected', 'lens-before', 'primary'),
    ('reachable-harbour-2026-10-09', "Reachability correction minus the bot's own opening", 'lens-corrected', 'value', 'descriptive'),
]


def mcnemar_exact(favours_a, favours_b):
    """Exact two-sided p-value (a Fraction) for `favours_a` versus `favours_b` changed pairs."""
    if favours_a < 0 or favours_b < 0 or int(favours_a) != favours_a or int(favours_b) != favours_b:
        raise ValueError('changed-pair counts must be non-negative integers')
    n = favours_a + favours_b
    if n == 0:
        return Fraction(1)
    tail = sum(comb(n, i) for i in range(min(favours_a, favours_b) + 1))
    return min(Fraction(1), Fraction(2 * tail, 2 ** n))


def self_test():
    known = {
        (0, 4): Fraction(1, 8),            # the owned-harbour primary comparison: p = 0.125
        (4, 0): Fraction(1, 8),            # symmetric
        (488, 487): Fraction(1),           # the reachability primary comparison: p = 1.0
        (0, 0): Fraction(1),               # no changed pairs, no evidence
        (1, 0): Fraction(1),
        (0, 5): Fraction(1, 16),           # 2 x 1/32
        (2, 10): Fraction(158, 4096),      # 2 x (1 + 12 + 66) / 2^12
        (5, 5): Fraction(1),
    }
    for (a, b), want in known.items():
        got = mcnemar_exact(a, b)
        assert got == want, f'mcnemar_exact({a}, {b}) = {got}, expected {want}'
    assert float(mcnemar_exact(0, 4)) == 0.125 and float(mcnemar_exact(488, 487)) == 1.0
    for bad in [(-1, 2), (1.5, 2)]:
        try:
            mcnemar_exact(*bad)
        except ValueError:
            continue
        raise AssertionError(f'mcnemar_exact{bad} should raise')
    print(f'exact McNemar self-test: {len(known)} known answers passed')


def load_rows(archive):
    """Rows of one archive, after checking its checksums against the archive's own report."""
    report = json.loads((EVIDENCE / f'{archive}.json').read_text())
    compressed = (EVIDENCE / report['rawData']['file']).read_bytes()
    assert hashlib.sha256(compressed).hexdigest() == report['rawData']['gzipSha256'], archive
    raw = gzip.decompress(compressed)
    assert hashlib.sha256(raw).hexdigest() == report['rawData']['jsonlSha256'], archive
    return [json.loads(line) for line in raw.splitlines()]


def changed_pairs(rows, arm_a, arm_b):
    """(pairs, favours A, favours B) over boards both arms played, keyed by bot hash seed and board seed."""
    boards = {}
    for row in rows:
        if row['arm'] in (arm_a, arm_b):
            boards.setdefault((int(row['hashseed']), row['seed']), {})[row['arm']] = row
    pairs = favours_a = favours_b = 0
    for board in boards.values():
        assert set(board) == {arm_a, arm_b}, 'every board must be played by both arms'
        assert board[arm_a]['seat'] == board[arm_b]['seat'], 'matched pairs share the subject seat'
        assert board[arm_a]['finished'] and board[arm_b]['finished']
        pairs += 1
        favours_a += int(board[arm_a]['win'] and not board[arm_b]['win'])
        favours_b += int(board[arm_b]['win'] and not board[arm_a]['win'])
    return pairs, favours_a, favours_b


def compute():
    cache, out = {}, []
    for archive, label, arm_a, arm_b, role in COMPARISONS:
        rows = cache.setdefault(archive, load_rows(archive))
        pairs, fa, fb = changed_pairs(rows, arm_a, arm_b)
        p = mcnemar_exact(fa, fb)
        out.append({'archive': archive, 'comparison': f'{arm_a}-minus-{arm_b}', 'label': label, 'role': role,
                    'pairs': pairs, 'changedPairs': fa + fb, 'favoursFirst': fa, 'favoursSecond': fb,
                    'pExact': [str(p.numerator), str(p.denominator)], 'pValue': float(f'{float(p):.6g}')})
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--self-test', action='store_true', help='check known answers only')
    parser.add_argument('--check', action='store_true', help='recompute and compare with exact-tests.json')
    parser.add_argument('--write', action='store_true', help='recompute and (re)write exact-tests.json')
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return
    results = compute()
    for r in results:
        print(f"{r['label']}: {r['changedPairs']:,} of {r['pairs']:,} pairs changed "
              f"({r['favoursFirst']:,} favour the first arm, {r['favoursSecond']:,} the second); exact p = {r['pValue']:.6g}")
    if args.write:
        SUMMARY.write_text(json.dumps({'method': 'exact two-sided McNemar (binomial) test on changed win/loss pairs',
                                       'comparisons': results}, indent=2) + '\n')
        print(f'wrote {SUMMARY.name}')
    if args.check:
        published = json.loads(SUMMARY.read_text())['comparisons']
        assert published == results, 'exact-tests.json does not match the raw archives'
        public = json.loads((HERE.parents[1] / 'public/media/results.json').read_text())['exactTests']
        assert public == [{k: r[k] for k in ('archive', 'comparison', 'role', 'pairs', 'changedPairs', 'favoursFirst', 'favoursSecond', 'pValue')}
                          for r in results], 'results.json exactTests does not match the raw archives'
        print(f'Verified {len(results)} exact tests against the raw archives, exact-tests.json and results.json.')


if __name__ == '__main__':
    main()

# Benchmark results

Every comparison below records its frozen policy. The newest test isolates complete harbour
reachability; both versions already contain the owned-harbour and rounding corrections. It does not
measure those earlier changes separately. No test outcomes tuned the policies, and the tests are not pooled.

## Exact tests on changed pairs, 2026-10-12

Each paired comparison below plays two strategies on the same boards and subject seats. Only pairs
whose win or loss differs carry information about a difference. If the strategies were equal, each
changed pair would be equally likely to favour either one, so an exact two-sided McNemar (binomial)
test asks whether the changed pairs lean one way more than chance explains.
[`exact_tests.py`](exact_tests.py) recomputes every value below from the raw archives using only the
Python standard library. Continuous integration checks them against [`exact-tests.json`](exact-tests.json)
and the public results file. This test ignores the clustering by bot hash seed; the clustered t
intervals estimate the size of a difference. From this date on, when fewer than 100 pairs change, the
exact test governs; otherwise a conclusion must agree with both.

| Comparison | Changed pairs (of 8,000) | Favour the first | Favour the second | Exact p |
|---|---|---|---|---|
| Fresh-seed test: Lens minus most pips | 2,252 | 1,442 | 810 | below 0.000001 |
| Fresh-seed test: Lens minus the bot's own opening | 2,637 | 1,309 | 1,328 | 0.73 |
| Owned-harbour correction minus the previous policy (primary) | 4 | 0 | 4 | 0.125 |
| Owned-harbour correction minus the bot's own opening | 2,625 | 1,306 | 1,319 | 0.81 |
| Reachability correction minus the previous policy (primary) | 975 | 488 | 487 | 1.0 |
| Reachability correction minus the bot's own opening | 2,630 | 1,298 | 1,332 | 0.52 |

Every published conclusion agrees with its exact test except the owned-harbour primary interval,
which is corrected in its erratum below. The original 2026-09-29 test kept no game records, so it has
no exact test.

## Harbour reachability correction, 2026-10-09

Policy `r7-reachable-ports-2026-10-09` counts every legal harbour settlement two roads away, including
inland approaches to either endpoint. Useful direct access retains priority, already-owned types stay
excluded, and bonus sizes and all non-port terms are unchanged. This repairs graph reachability;
winning outcomes do not determine whether a route is legal.

The [plan](evidence/reachable-harbour-plan-2026-10-09.json) was recorded at **2026-10-10T05:16:22Z**
(9 October in Pacific time). The baseline was frozen then at
[`94838bc`](https://github.com/buffbeefalo/catan-lens/tree/94838bc0b9db863384dc8ed678211b789ff02b94).
The corrected policy was frozen at **05:26:04Z**, before its games, at
[`cfa7f48`](https://github.com/buffbeefalo/catan-lens/tree/cfa7f484a61be5983572ad689431014d8b562984).
Only the scoring input differs among the nine frozen source files. Python dependencies, Catanatron
and its opponent policy match the preceding test. Both policies contain the half-cent rounding repair.

Hash seeds **301–320** and board seeds **3,000,000–3,007,999** are separate from every earlier test.
Each arm plays 8,000 matched boards and subject seats, in 20 clusters of 400 boards. All **24,000 games
finished**; the records were independently checked at **05:42:35Z**. There were no outcome-based retries.

| Opening chosen by | Wins / games | Win rate (95% interval) |
|---|---|---|
| Lens with complete harbour reachability | 1,981 / 8,000 | 24.8% ± 1.1 |
| Lens before the reachability correction | 1,980 / 8,000 | 24.8% ± 1.0 |
| The bot's own opening | 2,015 / 8,000 | 25.2% ± 1.1 |

The exact Lens rates are 24.7625% and 24.7500%. The predeclared primary comparison subtracts the
baseline from the correction within each cluster, then uses a two-sided approximate 95% Student t
interval over the 20 differences (19 degrees of freedom). The value-bot comparison is descriptive.

| Comparison | Difference in percentage points | Approximate 95% interval |
|---|---|---|
| Corrected Lens minus previous Lens (primary) | +0.0125 | −0.7705 to +0.7955 |
| Corrected Lens minus bot's own opening (descriptive) | −0.4250 | −1.7202 to +0.8702 |

One additional win does not establish an advantage or prove equivalent performance. There are **975
changed win/loss pairs**: 488 losses become wins and 487 wins become losses. In total, 3,445 paired
records differ in win, victory points or turns. The archive does not contain every move, so matching
result fields do not prove identical game histories.

Subject seats are **2,022 / 1,995 / 1,972 / 2,011** for seats 1–4, identically in each arm. This is a
four-player base-game bot experiment, not an estimate of human improvement or evidence for other
player counts or Cities & Knights. Both paired intervals include a disadvantage and an advantage.

### Check the reachability comparison

- [All 24,000 games, compressed JSON Lines](evidence/reachable-harbour-2026-10-09.jsonl.gz)
- [Frozen source hashes, clusters and exact comparisons](evidence/reachable-harbour-2026-10-09.json)
- [Standard-library verifier](verify_reachable_harbours.py)
- [Frozen Python dependencies](evidence/requirements-2026-10-09.txt)

```sh
python3 bench/catanatron/verify_reachable_harbours.py
python3 bench/catanatron/verify_reachable_harbours.py --sources
```

The verifier checks both archive hashes, all finished paired games, subject seats, each cluster's
counts, exact wins, changed outcomes, intervals and public figures. The source option also compares
all nine inputs with the recorded commits and needs full git history. Continuous integration checks
this archive alongside the two earlier experiments. Fault checks reject missing/wrong public counts,
wrong cluster counts, duplicate games, mismatched seats, unfinished games and a wrong paired interval.

### Reproduce the reachability comparison

Use separate checkouts at the two commits above and the frozen Python dependencies. For runs 1–20,
use `arms=value,lens` in the baseline checkout and `arms=lens` in the corrected checkout, with separate
output directories. The environment setup follows the fresh-seed instructions below.

```sh
PYTHONHASHSEED=$((300 + run)) .venv/bin/python bench/catanatron/catanatron_bench.py \
  --games 400 --start $((3000000 + (run - 1) * 400)) --jobs 4 \
  --arms "$arms" --out "comparison-output/run-$run.jsonl"
```

## Owned-harbour correction, 2026-10-09

Policy `r7-owned-ports-2026-10-09` removes R7 credit for a harbour type already supplied by your
settlements. It preserves all bonus magnitudes and other scoring weights. This rules-correctness
repair was fixed before its games; outcomes were not used to tune it or select a policy.

The [plan](evidence/owned-harbour-plan-2026-10-09.json) was recorded at **2026-10-10T00:57:41Z**
(9 October in Pacific time). The baseline snapshot was frozen then; the corrected snapshot was frozen
at **01:10:10Z**, before its first game. All nine baseline inputs match commit
[`6955a68`](https://github.com/buffbeefalo/catan-lens/tree/6955a683c1c9e7eba2560614bda98ac95d11ebe5);
all nine corrected inputs match
[`2f8c75c`](https://github.com/buffbeefalo/catan-lens/tree/2f8c75c7e14e385df50cea6ed825c3500ac5ea91).
Only the scoring input differs between snapshots.

Hash seeds **201–220** and board seeds **2,000,000–2,007,999** are separate from both earlier tests.
Each strategy plays the same 8,000 boards and subject seats, grouped into 20 clusters of 400 boards.
All **24,000 games finished**. Python, Catanatron and the value-function opponent policy are unchanged.

| Opening chosen by | Wins / games | Win rate (95% interval) |
|---|---|---|
| Lens with owned-harbour correction | 1,972 / 8,000 | 24.7% ± 1.1 |
| Lens before the correction | 1,976 / 8,000 | 24.7% ± 1.0 |
| The bot's own opening | 1,985 / 8,000 | 24.8% ± 0.9 |

Both Lens rates round to 24.7%, but their exact rates are 24.6500% and 24.7000%. The predeclared
primary comparison subtracts old Lens from corrected Lens within each cluster, using the same
approximate 95% t-interval method described below. The comparison with the value bot is descriptive.

| Comparison | Difference in percentage points | Approximate 95% interval |
|---|---|---|
| Corrected Lens minus Lens before correction (primary) | −0.0500 | −0.0980 to −0.0020 |
| Corrected Lens minus bot's own opening (descriptive) | −0.1625 | −1.6749 to +1.3499 |

The correction won **four fewer games**. Only four matched win/loss pairs differ, all favoring the
older policy; four clusters each lose one win and 16 have identical win counts. The primary interval
lies slightly below zero, but its narrowness relies on a t approximation with very sparse differences.
Keep that limitation with the reported interval; this is no demonstrated win-rate gain or proof of
equivalent policies. Thirteen paired records differ in win, victory points or turns; the archive
does not record every move, so identical result fields do not establish identical game histories.

**Erratum, 2026-10-12.** The primary interval above (−0.0980 to −0.0020) excludes zero only because
the changes were sparse. Sixteen of the 20 cluster differences are exactly zero, so a t interval over
the 20 cluster means is not a valid basis here. The [exact test](#exact-tests-on-changed-pairs-2026-10-12)
on the four changed pairs (none favour the correction, four favour the previous policy) gives
p = 0.125: no significant difference between the two policies. The conclusion above (no demonstrated
gain, no proof of equivalence) is unchanged. The archived report and its public figures are kept as
recorded.

Subject seats were distributed **2,023 / 1,977 / 2,033 / 1,967** across seats 1–4, identically for each
strategy. These are four-player base-game bots, not evidence of human improvement, other table sizes
or Cities & Knights. The repair corrects the explanation of trading access; its rationale does not
depend on gaining wins in this sample.

### Check this comparison

- [All 24,000 games, compressed JSON Lines](evidence/owned-harbour-2026-10-09.jsonl.gz)
- [Frozen input hashes, exact results, clusters and paired differences](evidence/owned-harbour-2026-10-09.json)
- [Standard-library verifier](verify_owned_harbours.py)
- [Frozen Python dependency versions](evidence/requirements-2026-10-09.txt)

```sh
python3 bench/catanatron/verify_owned_harbours.py
python3 bench/catanatron/verify_owned_harbours.py --sources
```

The first command verifies the archive, complete paired games, seats, cluster counts, exact wins,
changed outcomes, intervals and public figures. The optional second command also checks all frozen
input hashes against their git commits and requires full repository history. Continuous integration
runs the first command along with the earlier holdout verifier. Original run hashes are retained in
the report; raw game records change only the Lens arm labels to distinguish old and corrected policies.

### Reproduce this comparison

Use separate checkouts at the two exact commits above and the frozen Python dependency versions.
For runs 1–20 in each checkout, use the invocation below. Set `arms=value,lens` for the baseline and
`arms=lens` for the correction; keep outputs in separate directories. Every run contains 400 boards.

```sh
PYTHONHASHSEED=$((200 + run)) .venv/bin/python bench/catanatron/catanatron_bench.py \
  --games 400 --start $((2000000 + (run - 1) * 400)) --jobs 4 \
  --arms "$arms" --out "comparison-output/run-$run.jsonl"
```

Use the fresh-seed setup instructions below for the environment, substituting the recorded commits.
This comparison is never pooled with the earlier results.

## Fresh-seed test, 2026-10-09

The opening policy was frozen before this test at Catan Lens commit
[`00cf63e78b7130772c8db86fc08b79ba0b7498d7`](https://github.com/buffbeefalo/catan-lens/tree/00cf63e78b7130772c8db86fc08b79ba0b7498d7).
The run plan was recorded at 2026-10-09T22:46:32Z. No scoring weights were tuned on these outcomes.
It used hash seeds **101–120**, board seeds **1,000,000–1,007,999**, and the same five strategies as the
original benchmark. Each hash seed supplies one cluster of 400 boards, with all five strategies tested
on the same board and subject seat. All **40,000 games finished**.

| Opening chosen by | Wins / games | Win rate (95% interval) |
|---|---|---|
| Catan Lens settlements and road | 1,944 / 8,000 | 24.3% ± 1.1 |
| Catan Lens settlements, bot's roads | 1,876 / 8,000 | 23.5% ± 1.2 |
| The bot's own opening | 1,963 / 8,000 | 24.5% ± 1.2 |
| Most pips | 1,312 / 8,000 | 16.4% ± 1.1 |
| Random corner | 119 / 8,000 | 1.5% ± 0.2 |

Intervals use the sample standard deviation of 20 cluster means, divided by the square root of 20,
then multiplied by the two-sided 95% t critical value for 19 degrees of freedom, 2.093024054408263.
Reported win rates round exact win counts to one decimal using decimal half-up rounding; inference
uses unrounded cluster means. The legacy summary's floating-point summation lands just above the
23.45% half tie for Lens settlements with bot roads; the exact fraction is 1,876 / 8,000.

For comparisons, subtract strategies **within each cluster**, then apply the same interval to the
20 differences. These paired intervals answer a different question from comparing separate error bars:

| Comparison | Difference in percentage points | 95% interval |
|---|---|---|
| Lens settlements and road minus bot's own opening | −0.2375 | −1.7974 to +1.3224 |
| Lens settlements and road minus most pips | +7.9000 | +6.5076 to +9.2924 |

The test supports an advantage over most-pips in this bot setting. The comparison with the bot's own
opening does not establish an advantage or prove equivalent performance. The results concern
four-player base-game bots; they do not estimate human improvement, other table sizes or C&K play.
Subject seats were distributed 2,007 / 1,954 / 1,995 / 2,044 across seats 1–4, identically for each strategy.

### Check the published records

- [All 40,000 games, compressed JSON Lines](evidence/holdout-2026-10-09.jsonl.gz)
- [Input hashes, exact results, cluster counts and paired intervals](evidence/holdout-2026-10-09.json)
- [Verifier using only Python's standard library](verify_holdout.py)
- [Frozen Python dependency versions](evidence/requirements-2026-10-09.txt)

Run from the repository root:

```sh
python3 bench/catanatron/verify_holdout.py
```

The verifier checks archive and decoded-data hashes, unique games, complete paired boards, seat
consistency, each cluster's counts, all finishes, intervals and the figures shown on the public page.
The stored archive contains only the eight game-result fields listed by the benchmark; it contains no
local paths or operational audit records. Every frozen input matches the source commit above.

### Reproduce the simulation

The audit used Python 3.12.3 and Catanatron commit
`ecf931181b9a65bb4116a2153fb78c16f1438e00`, pinned in the frozen source's requirements. Use a separate
checkout at the recorded Catan Lens commit so later policy changes do not alter the experiment:

```sh
git worktree add --detach ../catan-lens-holdout 00cf63e78b7130772c8db86fc08b79ba0b7498d7
python3 -m venv ../catan-lens-holdout/.venv
../catan-lens-holdout/.venv/bin/pip install -r bench/catanatron/evidence/requirements-2026-10-09.txt
cd ../catan-lens-holdout
mkdir holdout-output
for run in $(seq 1 20); do
  PYTHONHASHSEED=$((100 + run)) .venv/bin/python bench/catanatron/catanatron_bench.py \
    --games 400 --start $((1000000 + (run - 1) * 400)) --jobs 4 \
    --arms value,lens,lens-sett,pips,random --out "holdout-output/run-$run.jsonl"
done
.venv/bin/python bench/catanatron/summarize.py holdout-output/run-*.jsonl
```

The legacy summarizer uses 2.09 for the t multiplier; the verifier above uses its full value and also
checks paired differences. Archive rows are sorted by hash seed, board seed and strategy, so worker
completion order does not affect their published checksum.

## Original test, 2026-09-29

Run on 2026-09-29 with `bench/catanatron/run.sh 20 400` (Catanatron at the commit in requirements.txt): 20 runs,
each under its own fixed `PYTHONHASHSEED` and its own 400 board seeds, five strategies per board, so 8,000 complete
four-player games per strategy and 40,000 in total. Every seat is Catanatron's value-function bot; only the subject
seat's opening differs. Intervals are 95% t-intervals across the 20 run means (each run is one cluster).

| Opening chosen by | Win rate (95% interval) | Games |
|---|---|---|
| Catan Lens settlements and road | 25.2% ± 1.2 | 8,000 |
| Catan Lens settlements, bot's roads | 24.9% ± 1.2 | 8,000 |
| The bot's own opening | 25.8% ± 1.3 | 8,000 |
| Most pips | 16.9% ± 0.9 | 8,000 |
| Random corner | 1.8% ± 0.3 | 8,000 |

The 2026-10-09 audit reran these same seeds and reproduced all five win counts and rounded intervals.
This is a replication of the original observations. It is not pooled with the fresh-seed test above.

Historical starting-road comparison (`road_deadends.py`, seeds 0–399, 2026-09-29 policies): the first
road had no legal settlement site one road farther away after setup in 22% of openings with Lens's
road and 42% with the bot's. Before that road-rule change, the Lens figure was 52%. These percentages
are not new measurements of the later scoring policies.

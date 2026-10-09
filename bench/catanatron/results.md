# Benchmark results

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

Starting roads (`road_deadends.py`, seeds 0-399, deterministic): the first road ends in a dead end after setup
22% of the time with Catan Lens's road and 42% with the bot's own. Before the 2026-09-29 road change, Catan Lens's
first road was a dead end 52% of the time.

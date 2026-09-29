# Benchmark results

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

Starting roads (`road_deadends.py`, seeds 0-399, deterministic): the first road ends in a dead end after setup
22% of the time with Catan Lens's road and 42% with the bot's own. Before the 2026-09-29 road change, Catan Lens's
first road was a dead end 52% of the time.

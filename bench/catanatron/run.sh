#!/usr/bin/env bash
# Repeat the benchmark under many fixed hash seeds (one bot "personality" each), then summarise.
#   bench/catanatron/run.sh [runs] [games-per-run] [out-dir]
set -euo pipefail
RUNS=${1:-20}; GAMES=${2:-400}; OUT=${3:-bench/catanatron/results}
mkdir -p "$OUT"
for h in $(seq 1 "$RUNS"); do
  f="$OUT/run-$h.jsonl"
  [ -s "$f" ] && continue   # resumable
  PYTHONHASHSEED=$h python bench/catanatron/catanatron_bench.py --games "$GAMES" --start $(( (h - 1) * GAMES )) \
    --arms value,lens,lens-sett,pips,random --out "$f" > /dev/null
  echo "run $h of $RUNS done"
done
python bench/catanatron/summarize.py "$OUT"/run-*.jsonl

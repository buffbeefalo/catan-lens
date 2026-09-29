"""Win rate per strategy with a cluster-robust 95% interval: each run (hash seed) is one cluster.

  python bench/catanatron/summarize.py results/run-*.jsonl [--json out.json]
"""
import json
import math
import sys
from collections import defaultdict

LABELS = {"lens": "Catan Lens settlements and road", "lens-sett": "Catan Lens settlements, bot's roads",
          "value": "The bot's own opening", "pips": "Most pips", "random": "Random corner"}


def main():
    args = sys.argv[1:]
    out = args[args.index("--json") + 1] if "--json" in args else None
    files = [a for a in args if a.endswith(".jsonl")]
    runs = defaultdict(lambda: defaultdict(list))  # arm -> run -> [win]
    for f in files:
        for line in open(f):
            r = json.loads(line)
            runs[r["arm"]][f].append(1 if r["win"] else 0)
    rows = []
    for arm in ["lens", "lens-sett", "value", "pips", "random"]:
        if arm not in runs:
            continue
        rates = [sum(w) / len(w) for w in runs[arm].values()]
        k = len(rates)
        n = sum(len(w) for w in runs[arm].values())
        mean = sum(rates) / k
        sd = math.sqrt(sum((x - mean) ** 2 for x in rates) / (k - 1)) if k > 1 else float("nan")
        half = 2.09 * sd / math.sqrt(k) if k > 1 else float("nan")  # t(0.975, ~19 df)
        rows.append({"key": arm, "label": LABELS[arm], "win": round(100 * mean, 1), "ci": round(100 * half, 1), "runs": k, "games": n})
    print(f"{'strategy':38} {'win%':>6} {'±95%':>6} {'runs':>5} {'games':>7}")
    for r in rows:
        print(f"{r['label']:38} {r['win']:6.1f} {r['ci']:6.1f} {r['runs']:5d} {r['games']:7d}")
    if out:
        json.dump({"games": min(r["games"] for r in rows), "runs": rows[0]["runs"], "arms": rows}, open(out, "w"), indent=1)


if __name__ == "__main__":
    main()

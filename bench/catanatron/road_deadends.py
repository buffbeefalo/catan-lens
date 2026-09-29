"""How often does a suggested starting road lead nowhere once the opening is over?

For each seed, the subject's two opening settlements come from Catan Lens; its roads come either from
Catan Lens (arm "lens") or from the bot itself (arm "lens-sett"). When the opening draft ends we count,
for each road, the open corners one more road beyond it (where the next settlement could go). Zero means
the road is a dead end. The opening phase is deterministic, so every arm sees identical situations.

  python bench/catanatron/road_deadends.py [first-seed] [last-seed]
"""
import collections
import os
import sys

from catanatron import Color, Game
from catanatron.models.enums import ActionType
from catanatron.players.value import ValueFunctionPlayer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import catanatron_bench as B  # noqa: E402


class Recorder(B.Subject):
    def __init__(self, *a):
        super().__init__(*a)
        self.roads = []

    def decide(self, game, actions):
        a = super().decide(game, actions)
        if game.state.is_initial_build_phase and a.action_type == ActionType.BUILD_ROAD:
            self.roads.append((self.opening[-1], tuple(a.value)))
        return a


def beyond(game, subject, graph):
    _, n2v, _ = subject.cache
    occ = {n2v[n] for n in game.state.board.buildings}
    nb = collections.defaultdict(set)
    for a, b in graph["edges"]:
        nb[a].add(b)
        nb[b].add(a)
    legal = {v for v in range(len(graph["vertices"])) if v not in occ and not (nb[v] & occ)}
    out = []
    for settlement, (x, y) in subject.roads:
        s = n2v[settlement]
        far = n2v[y] if n2v[x] == s else n2v[x]
        out.append(sum(1 for w in nb[far] if w != s and w in legal))
    return out


def main():
    lo, hi = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (0, 400)
    bridge = B.Bridge()
    graph = bridge.ask(op="graph")
    for arm in ["lens", "lens-sett"]:
        counts = []
        for seed in range(lo, hi):
            subject = Recorder(Color.RED, arm, bridge, graph)
            game = Game([subject] + [ValueFunctionPlayer(c) for c in B.COLORS[1:]], seed=seed)
            while game.state.is_initial_build_phase:
                game.play_tick()
            counts.append(beyond(game, subject, graph))
        first = sum(c[0] == 0 for c in counts) / len(counts)
        second = sum(c[1] == 0 for c in counts) / len(counts)
        print(f"{arm:10} roads by {'Catan Lens' if arm == 'lens' else 'the bot':10}: first road a dead end {100 * first:.0f}%, "
              f"second {100 * second:.0f}% ({hi - lo} openings)")


if __name__ == "__main__":
    main()

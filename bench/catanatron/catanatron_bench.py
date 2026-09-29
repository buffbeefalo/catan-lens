"""Does following Catan Lens's opening advice win more games?

Plays full 4-player games in Catanatron (https://github.com/bcollazo/catanatron). Every seat is
Catanatron's ValueFunctionPlayer. One seat, the *subject*, has its two opening settlements (and
optionally their free roads) chosen by a policy instead of by the bot itself:

  value      the bot's own choice (control)
  lens       Catan Lens's ranking for settlements and its suggested starting road (R13)
  lens-sett  Catan Lens's settlements, the bot's own roads
  pips       the corner with the most raw pips (the simplest common rule), bot's roads
  random     a uniformly random legal corner, bot's roads (floor)

The same seeds are used for every arm, so each arm sees the same boards and seat orders, and the
opening phase is fully deterministic. After the opening, the subject plays exactly like the other
three bots.

Important: the bots break ties between equally valued moves in Python's hash order, which is
randomised per interpreter (PYTHONHASHSEED) and shared by every worker of one run. Each run therefore
plays with one arbitrary bot "personality", and how well a bot exploits an opening it did not choose
itself varies with that personality far more than game-to-game noise suggests. Games inside one run
are NOT independent samples. Use run.sh, which repeats the benchmark under many fixed hash seeds, and
summarize.py, which treats each hash seed as one cluster.

Usage:  python bench/catanatron/catanatron_bench.py --games 1000 --arms value,lens,pips,random --jobs 8
"""
import argparse
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

from catanatron import Color, Game
from catanatron.models.enums import ActionType
from catanatron.models.map import LandTile, NodeRef
from catanatron.players.value import ValueFunctionPlayer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # bench/, where lens-bridge.mjs lives
SQRT3 = math.sqrt(3)
RES = {"WOOD": "wood", "BRICK": "brick", "SHEEP": "sheep", "WHEAT": "wheat", "ORE": "ore", None: "desert"}
NODE_OFFSET = {
    NodeRef.NORTH: (0, -1), NodeRef.NORTHEAST: (SQRT3 / 2, -0.5), NodeRef.SOUTHEAST: (SQRT3 / 2, 0.5),
    NodeRef.SOUTH: (0, 1), NodeRef.SOUTHWEST: (-SQRT3 / 2, 0.5), NodeRef.NORTHWEST: (-SQRT3 / 2, -0.5),
}


class Bridge:
    """Talks to bench/lens-bridge.mjs: one JSON line out, one back."""

    def __init__(self):
        self.p = subprocess.Popen(["node", os.path.join(HERE, "lens-bridge.mjs")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, bufsize=1)

    def ask(self, **q):
        self.p.stdin.write(json.dumps(q) + "\n")
        out = json.loads(self.p.stdout.readline())
        if "error" in out:
            raise RuntimeError(out["error"])
        return out


def tile_xy(coord):
    x, _, z = coord  # cube -> axial (q = x, r = z) -> pointy-top pixel, size 1
    return SQRT3 * (x + z / 2), 1.5 * z


def near(points, x, y):
    best = min(range(len(points)), key=lambda i: (points[i][0] - x) ** 2 + (points[i][1] - y) ** 2)
    d = math.hypot(points[best][0] - x, points[best][1] - y)
    if d > 1e-6:
        raise RuntimeError(f"no Lens point at ({x:.3f},{y:.3f}); nearest is {d:.3f} away")
    return best


def translate(catan_map, graph):
    """Map a Catanatron board onto Lens ids. Returns (lens_board, node->vertex, vertex->node, edge lookup)."""
    lens_hex = [(h["x"], h["y"]) for h in graph["hexes"]]
    lens_v = [(v["x"], v["y"]) for v in graph["vertices"]]
    lands = [(c, t) for c, t in catan_map.land_tiles.items()]
    # Align the two frames: same centroid (the grid spacing is already identical).
    cx = sum(tile_xy(c)[0] for c, _ in lands) / len(lands); cy = sum(tile_xy(c)[1] for c, _ in lands) / len(lands)
    lx = sum(p[0] for p in lens_hex) / len(lens_hex); ly = sum(p[1] for p in lens_hex) / len(lens_hex)
    dx, dy = lx - cx, ly - cy
    hexes = [None] * len(lens_hex)
    tile_to_hex = {}
    node_to_v = {}
    for coord, t in lands:
        x, y = tile_xy(coord)
        hi = near(lens_hex, x + dx, y + dy)
        tile_to_hex[t.id] = hi
        hexes[hi] = {"resource": RES[t.resource], "number": t.number}
        for ref, nid in t.nodes.items():
            ox, oy = NODE_OFFSET[ref]
            node_to_v[nid] = near(lens_v, x + dx + ox, y + dy + oy)
    v_to_node = {v: n for n, v in node_to_v.items()}
    # Ungameable check: every node touches exactly the same tiles on both sides.
    for nid, vid in node_to_v.items():
        ours = sorted(tile_to_hex[t.id] for t in catan_map.adjacent_tiles[nid])
        if ours != sorted(graph["vertices"][vid]["hexes"]):
            raise RuntimeError(f"node {nid} -> vertex {vid}: tiles {ours} vs {graph['vertices'][vid]['hexes']}")
    edge_id = {tuple(sorted(e)): i for i, e in enumerate(graph["edges"])}
    harbors = {}
    for res, nodes in catan_map.port_nodes.items():
        vs = [node_to_v[n] for n in nodes]
        for i, a in enumerate(vs):
            for b in vs[i + 1:]:
                e = edge_id.get(tuple(sorted((a, b))))
                if e is not None:
                    harbors[str(e)] = "3:1" if res is None else RES[res]
    expected = sum(len(n) // 2 for n in catan_map.port_nodes.values())
    if len(harbors) != expected:
        raise RuntimeError(f"harbour mapping found {len(harbors)} of {expected}")
    return {"hexes": hexes, "harbors": harbors}, node_to_v, v_to_node


class Subject(ValueFunctionPlayer):
    """A ValueFunctionPlayer whose opening settlements (and maybe roads) come from a policy."""

    def __init__(self, color, policy, bridge, graph):
        super().__init__(color)
        self.policy, self.bridge, self.graph = policy, bridge, graph
        self.cache = None
        self.opening = []

    def decide(self, game, playable_actions):
        st = game.state
        if self.policy == "value" or not st.is_initial_build_phase:
            return super().decide(game, playable_actions)
        if self.cache is None:
            self.cache = translate(game.state.board.map, self.graph)
        board, n2v, v2n = self.cache
        seat = st.colors.index(self.color) + 1
        occupied = [n2v[n] for n in st.board.buildings]
        mine = [n2v[n] for n, (c, _) in st.board.buildings.items() if c == self.color]
        kind = playable_actions[0].action_type
        if kind == ActionType.BUILD_SETTLEMENT:
            policy = "lens" if self.policy.startswith("lens") else self.policy
            vid = self.bridge.ask(op="settle", board=board, seat=seat, players=len(st.colors), mine=mine,
                                  occupied=occupied, policy=policy)["vertex"]
            want = v2n[vid]
            self.opening.append(want)
            return next(a for a in playable_actions if a.value == want)
        if kind == ActionType.BUILD_ROAD and self.policy == "lens":
            last = self.opening[-1]
            e = self.bridge.ask(op="road", board=board, seat=seat, players=len(st.colors), mine=mine,
                                occupied=occupied, vertex=n2v[last])["edge"]
            if e is not None:
                want = tuple(sorted(v2n[v] for v in e))
                for a in playable_actions:
                    if tuple(sorted(a.value)) == want:
                        return a
        return super().decide(game, playable_actions)


COLORS = [Color.RED, Color.BLUE, Color.WHITE, Color.ORANGE]
_bridge = _graph = None


def play(job):
    global _bridge, _graph
    arm, seed = job
    if _bridge is None:
        _bridge = Bridge()
        _graph = _bridge.ask(op="graph")
    _bridge.ask(op="seed", seed=seed + 1)
    subject = Subject(Color.RED, arm, _bridge, _graph)
    game = Game([subject] + [ValueFunctionPlayer(c) for c in COLORS[1:]], seed=seed)
    winner = game.play()
    vp = {c.value: game.state.player_state[f"P{game.state.color_to_index[c]}_ACTUAL_VICTORY_POINTS"] for c in COLORS}
    return {"arm": arm, "seed": seed, "hashseed": os.environ.get("PYTHONHASHSEED"), "seat": game.state.colors.index(Color.RED) + 1,
            "win": winner == Color.RED, "finished": winner is not None, "vp": vp["RED"], "turns": game.state.num_turns}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--arms", default="value,lens,lens-sett,pips,random")
    ap.add_argument("--jobs", type=int, default=os.cpu_count())
    ap.add_argument("--start", type=int, default=0, help="first seed")
    ap.add_argument("--out", default=None, help="write every game as JSON lines here")
    a = ap.parse_args()
    arms = a.arms.split(",")
    jobs = [(arm, s) for s in range(a.start, a.start + a.games) for arm in arms]
    with ProcessPoolExecutor(a.jobs) as ex:
        rows = list(ex.map(play, jobs, chunksize=8))
    if a.out:
        with open(a.out, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    print(f"{a.games} games per arm, seeds {a.start}..{a.start + a.games - 1}; 4 ValueFunctionPlayers, subject seat varies")
    print(f"{'arm':10} {'win%':>6} {'±95%':>6} {'avg VP':>7} {'unfinished':>10}")
    for arm in arms:
        rs = [r for r in rows if r["arm"] == arm]
        p = sum(r["win"] for r in rs) / len(rs)
        ci = 1.96 * math.sqrt(p * (1 - p) / len(rs))
        print(f"{arm:10} {100 * p:6.1f} {100 * ci:6.1f} {sum(r['vp'] for r in rs) / len(rs):7.2f} {sum(not r['finished'] for r in rs):10d}")


if __name__ == "__main__":
    sys.exit(main())

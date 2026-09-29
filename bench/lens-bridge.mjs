// Line-oriented bridge so an outside game engine can ask Catan Lens for opening picks.
// stdin: one JSON request per line; stdout: one JSON reply per line.
//   {"op":"graph"}                                  -> the base board's hexes, vertices and edges
//   {"op":"settle", board, seat, players, mine, occupied, policy}  -> {"vertex": id}
//   {"op":"road", board, seat, players, mine, occupied, vertex}    -> {"edge": id | null}
// `board` = {hexes:[{resource, number}] in Lens hex order, harbors:{edgeId: type}}.
// policy "lens" = the app's ranking; "pips" = most raw pips (ties: lowest id); "random" = uniform legal corner.
import { createInterface } from 'node:readline';
import { boardFrom, PIPS } from '../public/board.js';
import { buildGraph, legalVertices } from '../public/geometry.js';
import { rankSpots, suggestRoad } from '../public/score.js';

const pips = (b, v) => b.graph.vertices[v].hexes.reduce((s, h) => s + (b.hexes[h].number ? PIPS[b.hexes[h].number] : 0), 0);
let seed = 1;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

function handle(q) {
  if (q.op === 'graph') {
    const g = buildGraph('base');
    return { hexes: g.hexes.map(h => ({ x: h.x, y: h.y })), vertices: g.vertices.map(v => ({ x: v.x, y: v.y, hexes: v.hexes })), edges: g.edges.map(e => e.v) };
  }
  if (q.op === 'seed') { seed = q.seed || 1; return { ok: true }; }
  const b = boardFrom({ setup: 'base', hexes: q.board.hexes, harbors: q.board.harbors });
  const settings = { players: q.players, seat: q.seat, cak: false };
  if (q.op === 'settle') {
    const legal = legalVertices(b.graph, q.occupied);
    if (q.policy === 'random') return { vertex: legal[Math.floor(rand() * legal.length)] };
    if (q.policy === 'pips') return { vertex: legal.reduce((a, v) => (pips(b, v) > pips(b, a) ? v : a)) };
    return { vertex: rankSpots(b, settings, { mine: q.mine.slice(0, 1), occupied: q.occupied })[0].id };
  }
  if (q.op === 'road') {
    const r = suggestRoad(b, settings, q.vertex, { mine: q.mine, occupied: q.occupied });
    return { edge: r ? b.graph.edges[r.edge].v : null };
  }
  throw new Error('unknown op ' + q.op);
}

createInterface({ input: process.stdin }).on('line', line => {
  let out;
  try { out = handle(JSON.parse(line)); } catch (e) { out = { error: String(e && e.message || e) }; }
  process.stdout.write(JSON.stringify(out) + '\n');
});

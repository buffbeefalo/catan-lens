import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, legalVertices, hexCenters, nearestVertex, nearestCoastalEdge } from '../public/geometry.js';

test('base board has 19 hexes, 54 vertices, 72 edges and a 30-edge coast', () => {
  const g = buildGraph('base');
  assert.equal(g.hexes.length, 19);
  assert.equal(g.vertices.length, 54);
  assert.equal(g.edges.length, 72);
  assert.equal(g.perimeter.length, 30);
  assert.equal(new Set(g.perimeter).size, 30, 'perimeter walk visits each coastal edge once');
});

test('5-6 player board has 30 hexes, 80 vertices, 109 edges', () => {
  const g = buildGraph('ext56');
  assert.equal(g.hexes.length, 30);
  assert.equal(g.vertices.length, 80);
  assert.equal(g.edges.length, 109);
  assert.equal(g.perimeter.length, g.edges.filter(e => e.hexes.length === 1).length);
});

test('every vertex touches 1-3 hexes and has 2-3 neighbours; centre vertices touch 3', () => {
  const g = buildGraph('base');
  for (const v of g.vertices) {
    assert.ok(v.hexes.length >= 1 && v.hexes.length <= 3, `vertex ${v.id} touches ${v.hexes.length}`);
    assert.ok(v.neighbors.length >= 2 && v.neighbors.length <= 3);
  }
  const centre = g.hexes.find(h => h.row === 2 && h.col === 2);
  for (const vid of centre.corners) assert.equal(g.vertices[vid].hexes.length, 3);
});

test('distance rule removes the vertex and its neighbours only', () => {
  const g = buildGraph('base');
  const v = g.vertices.find(v => v.hexes.length === 3);
  const legal = legalVertices(g, [v.id]);
  assert.equal(legal.length, 54 - 1 - v.neighbors.length);
  assert.ok(!legal.includes(v.id));
  for (const n of v.neighbors) assert.ok(!legal.includes(n));
});

test('rows are centred so the widest row sets the left margin', () => {
  const c = hexCenters([3, 4, 5, 4, 3]);
  const minX = Math.min(...c.map(h => h.x));
  assert.ok(Math.abs(minX - Math.sqrt(3) / 2) < 1e-9);
});

test('point selection uses the closest corner, independent of paint order, within a bounded reach', () => {
  const graph = { vertices: [{ id: 0, x: 0, y: 0 }, { id: 1, x: 1, y: 0 }] };
  assert.equal(nearestVertex(graph, { x: 0.2, y: 0 }, 0.8), 0);
  assert.equal(nearestVertex({ vertices: [...graph.vertices].reverse() }, { x: 0.2, y: 0 }, 0.8), 0);
  assert.equal(nearestVertex(graph, { x: 0.5, y: 1 }, 0.8), null);
  assert.equal(nearestVertex(graph, { x: 0, y: 0.8 }, 0.8), 0);
  assert.equal(nearestVertex(graph, { x: 0, y: 0.801 }, 0.8), null);
});

test('coastal selection measures finite segments, ignores inland edges and breaks ties consistently', () => {
  const graph = {
    vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: .2 }, { x: 2, y: .2 }],
    edges: [{ v: [0, 1] }, { v: [2, 3] }, { v: [4, 5] }], perimeter: [1, 0],
  };
  assert.equal(nearestCoastalEdge(graph, { x: 1, y: .2 }, .3), 0, 'an inland edge is never a harbour target');
  assert.equal(nearestCoastalEdge(graph, { x: 2.5, y: 0 }, .5), 0, 'equal distances use the smaller edge id');
  assert.equal(nearestCoastalEdge({ ...graph, perimeter: [0, 1] }, { x: 2.5, y: 0 }, .5), 0);
  assert.equal(nearestCoastalEdge(graph, { x: 2.7, y: 1 }, .4), 1);
  assert.equal(nearestCoastalEdge(graph, { x: 5, y: 0 }, 1), null, 'extending the line beyond its endpoints must not create a hit');
  assert.equal(nearestCoastalEdge(graph, { x: 1, y: .301 }, .3), null);
});

test('every real coastal midpoint selects its own edge and hex centers are outside the editing reach', () => {
  for (const layout of ['base', 'ext56']) {
    const graph = buildGraph(layout);
    for (const id of graph.perimeter) {
      const [a, b] = graph.edges[id].v.map(v => graph.vertices[v]);
      assert.equal(nearestCoastalEdge(graph, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, .65), id);
    }
    for (const hex of graph.hexes) assert.equal(nearestCoastalEdge(graph, hex, .65), null);
  }
});

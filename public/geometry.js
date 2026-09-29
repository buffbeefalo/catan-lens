// Board geometry: pointy-top hexes laid out in offset rows, shared corners (vertices) and
// sides (edges) de-duplicated by rounded pixel position. Pure functions, no DOM, so the
// same file runs in the browser and under node --test.

export const LAYOUTS = {
  // Official Settlers board: rows of 3,4,5,4,3 land hexes (19).
  base: { rows: [3, 4, 5, 4, 3] },
  // Official 5-6 player extension: rows of 3,4,5,6,5,4,3 land hexes (30).
  ext56: { rows: [3, 4, 5, 6, 5, 4, 3] },
};

const SQRT3 = Math.sqrt(3);

// Hex centers for a row layout. Unit: hex "size" (center to corner) = 1.
// Pointy-top: width = sqrt3, vertical row pitch = 1.5.
export function hexCenters(rows) {
  const maxRow = Math.max(...rows);
  const out = [];
  rows.forEach((n, r) => {
    const x0 = ((maxRow - n) * SQRT3) / 2;
    for (let i = 0; i < n; i++) out.push({ id: out.length, row: r, col: i, x: x0 + i * SQRT3 + SQRT3 / 2, y: r * 1.5 + 1 });
  });
  return out;
}

// Six corners of a pointy-top hex, starting at the top and going clockwise.
export function hexCorners(cx, cy) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90);
    pts.push([cx + Math.cos(a), cy + Math.sin(a)]);
  }
  return pts;
}

const key = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;

// Build the full graph: hexes with their corner vertex ids, vertices with adjacent hexes and
// neighbouring vertices, edges with their two vertices and touching hexes, plus the
// perimeter (coastal edges in clockwise walking order) for harbour placement.
export function buildGraph(layoutName) {
  const rows = LAYOUTS[layoutName].rows;
  const hexes = hexCenters(rows).map(h => ({ ...h, corners: [] }));
  const vertices = [];
  const vIndex = new Map();
  const edges = [];
  const eIndex = new Map();

  for (const h of hexes) {
    const corners = hexCorners(h.x, h.y);
    const ids = corners.map(([x, y]) => {
      const k = key(x, y);
      if (!vIndex.has(k)) {
        vIndex.set(k, vertices.length);
        vertices.push({ id: vertices.length, x, y, hexes: [], neighbors: new Set(), edges: [] });
      }
      const v = vertices[vIndex.get(k)];
      v.hexes.push(h.id);
      return v.id;
    });
    h.corners = ids;
    for (let k = 0; k < 6; k++) {
      const a = ids[k], b = ids[(k + 1) % 6];
      const ek = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!eIndex.has(ek)) {
        eIndex.set(ek, edges.length);
        edges.push({ id: edges.length, v: [Math.min(a, b), Math.max(a, b)], hexes: [] });
        vertices[a].neighbors.add(b); vertices[b].neighbors.add(a);
        vertices[a].edges.push(eIndex.get(ek)); vertices[b].edges.push(eIndex.get(ek));
      }
      edges[eIndex.get(ek)].hexes.push(h.id);
    }
  }
  for (const v of vertices) v.neighbors = [...v.neighbors];

  // Coastal edges touch exactly one hex. Walk them in a loop by shared vertices.
  const coast = edges.filter(e => e.hexes.length === 1);
  const byVertex = new Map();
  for (const e of coast) for (const v of e.v) { if (!byVertex.has(v)) byVertex.set(v, []); byVertex.get(v).push(e); }
  const perimeter = [];
  const seen = new Set();
  // Start at the top-left-most coastal edge, walk so that the loop goes clockwise (x increasing at the top).
  let cur = coast.slice().sort((a, b) => (vertices[a.v[0]].y + vertices[a.v[1]].y) - (vertices[b.v[0]].y + vertices[b.v[1]].y)
    || (vertices[a.v[0]].x + vertices[a.v[1]].x) - (vertices[b.v[0]].x + vertices[b.v[1]].x))[0];
  let from = vertices[cur.v[0]].x < vertices[cur.v[1]].x ? cur.v[0] : cur.v[1];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); perimeter.push(cur.id);
    const to = cur.v[0] === from ? cur.v[1] : cur.v[0];
    cur = byVertex.get(to).find(e => !seen.has(e.id));
    from = to;
  }

  return { layout: layoutName, rows, hexes, vertices, edges, perimeter };
}

// Distance rule: a vertex is buildable only if no neighbouring vertex holds a settlement.
export function legalVertices(graph, occupied) {
  const occ = new Set(occupied);
  return graph.vertices.filter(v => !occ.has(v.id) && !v.neighbors.some(n => occ.has(n))).map(v => v.id);
}

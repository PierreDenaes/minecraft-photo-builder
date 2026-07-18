// Nettoyage des scans : composantes connexes (sommets partagés) + crop percentile
function cleanTriangles(triangles) {
  const total = triangles.length;
  if (total === 0) return { triangles, removed: 0 };

  const parent = [];
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const vkey = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;
  const vidx = new Map();
  const vertId = (p) => {
    const k = vkey(p);
    if (!vidx.has(k)) { vidx.set(k, parent.length); parent.push(parent.length); }
    return vidx.get(k);
  };
  const triVert = triangles.map((t) => {
    const ids = [vertId(t.a), vertId(t.b), vertId(t.c)];
    union(ids[0], ids[1]);
    union(ids[1], ids[2]);
    return ids[0];
  });
  const compOf = triVert.map((v) => find(v));
  const count = new Map();
  for (const r of compOf) count.set(r, (count.get(r) || 0) + 1);
  const biggest = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const kept = triangles.filter((t, i) => compOf[i] === biggest || count.get(compOf[i]) >= total * 0.03);

  // crop percentile 2-98 des centroïdes par axe
  const cent = kept.map((t) => [0, 1, 2].map((a) => (t.a[a] + t.b[a] + t.c[a]) / 3));
  const bounds = [0, 1, 2].map((a) => {
    const vals = cent.map((c) => c[a]).sort((x, y) => x - y);
    const at = (p) => vals[Math.max(0, Math.min(vals.length - 1, Math.floor(p * vals.length)))];
    return [at(0.02), at(0.98)];
  });
  const margin = bounds.map(([lo, hi]) => (hi - lo) * 0.05 + 1e-6);
  const final = kept.filter((t, i) =>
    [0, 1, 2].every((a) => cent[i][a] >= bounds[a][0] - margin[a] && cent[i][a] <= bounds[a][1] + margin[a])
  );
  return { triangles: final, removed: total - final.length };
}

module.exports = { cleanTriangles };

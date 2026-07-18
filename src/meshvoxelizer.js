const { nearestBlock } = require('./blockcolors');

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];

function voxelizeMesh(triangles, { maxX, maxY, maxZ, defaultBlock, colors, zUp = false }) {
  if (!triangles.length) throw new Error('modèle vide : aucun triangle');
  const pick = typeof colors === 'function' ? colors : (colors ? (r, g, b) => nearestBlock(r, g, b, colors) : null);
  const axis = ([x, y, z]) => (zUp ? [x, z, y] : [x, y, z]);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      const q = axis(p);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], q[i]);
        max[i] = Math.max(max[i], q[i]);
      }
    }
  }
  const span = [max[0] - min[0] || 1, max[1] - min[1] || 1, max[2] - min[2] || 1];
  const scale = Math.min((maxX - 1) / span[0], (maxY - 1) / span[1], (maxZ - 1) / span[2]);
  const toVox = (p) => {
    const q = axis(p);
    return [(q[0] - min[0]) * scale, (q[1] - min[1]) * scale, (q[2] - min[2]) * scale];
  };
  const marked = new Map();
  const mark = (p, block) => marked.set(`${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2])}`, block);
  function rasterize(a, b, c, block) {
    if (Math.max(dist(a, b), dist(b, c), dist(a, c)) < 0.5) { mark(a, block); return; }
    const ab = mid(a, b), bc = mid(b, c), ac = mid(a, c);
    rasterize(a, ab, ac, block);
    rasterize(ab, b, bc, block);
    rasterize(ac, bc, c, block);
    rasterize(ab, bc, ac, block);
  }
  for (const t of triangles) {
    const block = t.color && pick ? pick(t.color[0], t.color[1], t.color[2]) : defaultBlock;
    const [a, b, c] = [toVox(t.a), toVox(t.b), toVox(t.c)];
    rasterize(a, b, c, block);
    mark(a, block); mark(b, block); mark(c, block);
  }
  return [...marked.entries()].map(([k, block]) => {
    const [x, y, z] = k.split(',').map(Number);
    return { x, y, z, block };
  });
}

module.exports = { voxelizeMesh };

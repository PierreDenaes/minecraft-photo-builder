const { nearestBlock } = require('./blockcolors');

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];

function voxelizeMesh(triangles, { maxX, maxY, maxZ, defaultBlock, colors, zUp = false, up, solid = false, underground, surfaceThemeOf }) {
  if (!triangles.length) throw new Error('modèle vide : aucun triangle');
  const pick = typeof colors === 'function' ? colors : (colors ? (r, g, b) => nearestBlock(r, g, b, colors) : null);
  const upAxis = up || (zUp ? 'z' : 'y');
  const axis = ([x, y, z]) => (upAxis === 'z' ? [x, z, y] : upAxis === 'x' ? [y, x, z] : [x, y, z]);
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

  if (solid) {
    // Logique géologique : strates uniquement sous le SOCLE de chaque colonne ;
    // les vides internes ne sont comblés que s'ils sont étroits (épaisseur de
    // structure) — les grands volumes d'air (cours, arches, ciels de scans IA)
    // restent ouverts au lieu de produire un monolithe.
    const MAX_GAP = 6;
    const columns = new Map(); // "x,z" → [y de coquille...]
    for (const [k] of marked) {
      const [x, y, z] = k.split(',').map(Number);
      const ck = `${x},${z}`;
      if (!columns.has(ck)) columns.set(ck, []);
      columns.get(ck).push(y);
    }
    for (const [ck, ys] of columns) {
      const [x, z] = ck.split(',').map(Number);
      ys.sort((a, b) => a - b);
      const bottom = ys[0];
      const theme = surfaceThemeOf ? surfaceThemeOf(marked.get(`${x},${bottom},${z}`)) : null;
      for (let y = 0; y < bottom; y++) {
        if (underground) {
          const filled = underground.fill(x, y, z, bottom - y, theme);
          if (filled !== null) marked.set(`${x},${y},${z}`, filled);
        } else {
          marked.set(`${x},${y},${z}`, defaultBlock);
        }
      }
      for (let i = 0; i + 1 < ys.length; i++) {
        const gap = ys[i + 1] - ys[i] - 1;
        if (gap > 0 && gap <= MAX_GAP) {
          const fillBlock = marked.get(`${x},${ys[i]},${z}`);
          for (let y = ys[i] + 1; y < ys[i + 1]; y++) {
            if (!marked.has(`${x},${y},${z}`)) marked.set(`${x},${y},${z}`, fillBlock);
          }
        }
      }
    }
  }

  return [...marked.entries()].map(([k, block]) => {
    const [x, y, z] = k.split(',').map(Number);
    return { x, y, z, block };
  });
}

module.exports = { voxelizeMesh };

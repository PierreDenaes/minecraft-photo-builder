const { hash01 } = require('./subsurface');

const TREES = {
  chene: { trunk: 'oak_log', leaves: 'oak_leaves', hMin: 4, hMax: 5 },
  sapin: { trunk: 'spruce_log', leaves: 'spruce_leaves', hMin: 5, hMax: 7 }
};

function plantVegetation(terrainBlocks, { seed = 1, densite = 0.02, exclude = null, types = ['chene', 'sapin'] } = {}) {
  const list = types.map((t) => TREES[t]).filter(Boolean);
  if (densite <= 0 || list.length === 0) return [];
  const surf = new Map();
  for (const b of terrainBlocks) {
    if (b.block !== 'grass_block') continue;
    const k = `${b.x},${b.z}`;
    if (!surf.has(k) || b.y > surf.get(k)) surf.set(k, b.y);
  }
  const out = [];
  for (const [k, y] of surf) {
    const [x, z] = k.split(',').map(Number);
    if (exclude && x >= exclude.x1 - 2 && x <= exclude.x2 + 2 && z >= exclude.z1 - 2 && z <= exclude.z2 + 2) continue;
    if (hash01(seed ^ 0x7E01, x, 0, z) >= densite) continue;
    const t = list[Math.floor(hash01(seed ^ 0x7E02, x, 1, z) * list.length)];
    const h = t.hMin + Math.floor(hash01(seed ^ 0x7E03, x, 2, z) * (t.hMax - t.hMin + 1));
    for (let i = 1; i <= h; i++) out.push({ x, y: y + i, z, block: t.trunk });
    const topY = y + h;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          if (dx === 0 && dz === 0 && dy === 0) continue;
          out.push({ x: x + dx, y: topY + dy, z: z + dz, block: t.leaves });
        }
      }
    }
    out.push({ x, y: topY + 2, z, block: t.leaves });
  }
  return out;
}

module.exports = { plantVegetation };

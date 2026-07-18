function terrainFromHeightmap(heightmap, { sizeX, sizeZ, maxHeight, underground, surfaceBlock = 'grass_block', taperWidth = 12 }) {
  const gz = heightmap.length;
  const gx = heightmap[0].length;
  const hmMax = Math.max(...heightmap.flat()) || 1;

  function sample(u, v) { // bilinéaire, u/v ∈ [0,1]
    const fx = u * (gx - 1);
    const fz = v * (gz - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(gx - 1, x0 + 1);
    const z1 = Math.min(gz - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const a = heightmap[z0][x0] * (1 - tx) + heightmap[z0][x1] * tx;
    const b = heightmap[z1][x0] * (1 - tx) + heightmap[z1][x1] * tx;
    return (a * (1 - tz) + b * tz) / hmMax;
  }

  function taper(x, z) {
    if (taperWidth <= 0) return 1;
    const d = Math.min(x, z, sizeX - 1 - x, sizeZ - 1 - z);
    if (d >= taperWidth) return 1;
    return (1 - Math.cos((Math.PI * d) / taperWidth)) / 2;
  }

  const blocks = [];
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const h = Math.round(sample(x / (sizeX - 1), z / (sizeZ - 1)) * maxHeight * taper(x, z));
      if (h <= 0) continue;
      blocks.push({ x, y: h, z, block: surfaceBlock });
      for (let y = h - 1; y >= 0; y--) {
        const depth = h - y;
        if (underground) {
          const filled = underground.fill(x, y, z, depth, 'vegetation');
          if (filled !== null) blocks.push({ x, y, z, block: filled });
        } else {
          blocks.push({ x, y, z, block: depth <= 2 ? 'dirt' : 'stone' });
        }
      }
    }
  }
  return blocks;
}

// Fondations : prolonge chaque colonne de base d'un bâtiment posé jusqu'au terrain local
function buildFoundations(baseCells, topY, heightAt, block = 'stone_bricks') {
  const out = [];
  for (const { x, z } of baseCells) {
    const ground = heightAt(x, z);
    for (let y = ground + 1; y <= topY; y++) out.push({ x, y, z, block });
  }
  return out;
}

module.exports = { terrainFromHeightmap, buildFoundations };

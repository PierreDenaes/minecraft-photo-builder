const { themeOfBlock } = require('./palette');

function analyzeStructure(blocks, { gridX = 16, gridZ = 12 } = {}) {
  const dims = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    dims.x = Math.max(dims.x, b.x + 1);
    dims.y = Math.max(dims.y, b.y + 1);
    dims.z = Math.max(dims.z, b.z + 1);
  }
  const heightmap = Array.from({ length: gridZ }, () => new Array(gridX).fill(0));
  const themeCount = new Map();
  for (const b of blocks) {
    const gx = Math.min(gridX - 1, Math.floor((b.x / dims.x) * gridX));
    const gz = Math.min(gridZ - 1, Math.floor((b.z / dims.z) * gridZ));
    heightmap[gz][gx] = Math.max(heightmap[gz][gx], b.y + 1);
    const t = themeOfBlock(b.block);
    if (t) themeCount.set(t, (themeCount.get(t) || 0) + 1);
  }
  const footprint = heightmap.map((row) => row.map((h) => (h > 0 ? 1 : 0)));

  // tours : cellules ≥ 80 % de la hauteur max, regroupées par adjacence (4-voisins)
  const hMax = Math.max(...heightmap.flat());
  const tall = heightmap.map((row) => row.map((h) => hMax > 1 && h >= hMax * 0.8));
  const seen = heightmap.map((row) => row.map(() => false));
  const towers = [];
  for (let z = 0; z < gridZ; z++) {
    for (let x = 0; x < gridX; x++) {
      if (!tall[z][x] || seen[z][x]) continue;
      const cells = [];
      const stack = [[x, z]];
      seen[z][x] = true;
      while (stack.length) {
        const [cx, cz] = stack.pop();
        cells.push([cx, cz]);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx >= 0 && nx < gridX && nz >= 0 && nz < gridZ && tall[nz][nx] && !seen[nz][nx]) {
            seen[nz][nx] = true;
            stack.push([nx, nz]);
          }
        }
      }
      const cellW = dims.x / gridX;
      const cellD = dims.z / gridZ;
      const cx = cells.reduce((s, c) => s + (c[0] + 0.5) * cellW, 0) / cells.length;
      const cz = cells.reduce((s, c) => s + (c[1] + 0.5) * cellD, 0) / cells.length;
      const height = Math.max(...cells.map(([gx2, gz2]) => heightmap[gz2][gx2]));
      const radius = Math.max(1, Math.round(Math.sqrt((cells.length * cellW * cellD) / Math.PI)));
      towers.push({ cx: Math.round(cx * 10) / 10, cz: Math.round(cz * 10) / 10, radius, height });
    }
  }
  const themes = [...themeCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const hSafe = Math.max(1, hMax);
  const carte = heightmap.map((row) => row.map((h) => String(Math.min(9, Math.round((h / hSafe) * 9)))).join(''));
  return { dims, heightmap, footprint, towers, themes, carte };
}

module.exports = { analyzeStructure };

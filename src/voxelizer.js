const { nearestBlock } = require('./blockcolors');

function sampleDepth(depthMap, u, v) {
  const dx = Math.min(depthMap.width - 1, Math.round(u * (depthMap.width - 1)));
  const dy = Math.min(depthMap.height - 1, Math.round(v * (depthMap.height - 1)));
  return depthMap.data[dy * depthMap.width + dx];
}

function isSky(d, v) {
  return d > 0.82 && v < 0.45;
}

function voxelizeScene(image, depthMap, { sizeX, sizeZ, maxY, colors }) {
  const pick = typeof colors === 'function' ? colors : (r, g, b) => nearestBlock(r, g, b, colors);
  const byCol = new Map(); // "x,z" → Map(y → block)
  const put = (x, z, y, block, overwrite) => {
    const key = `${x},${z}`;
    if (!byCol.has(key)) byCol.set(key, new Map());
    if (overwrite || !byCol.get(key).has(y)) byCol.get(key).set(y, block);
  };
  for (let vx = 0; vx < sizeX; vx++) {
    for (let vy = 0; vy < maxY; vy++) {
      const u = sizeX === 1 ? 0 : vx / (sizeX - 1);
      const v = maxY === 1 ? 0 : 1 - vy / (maxY - 1); // v = 0 en haut de l'image
      const d = sampleDepth(depthMap, u, v);
      if (isSky(d, v)) continue;
      const z = (sizeZ - 1) - Math.round(d * (sizeZ - 1)); // proche = grand z
      const ix = Math.min(image.width - 1, Math.round(u * (image.width - 1)));
      const iy = Math.min(image.height - 1, Math.round(v * (image.height - 1)));
      const i = (iy * image.width + ix) * 3;
      const block = pick(image.data[i], image.data[i + 1], image.data[i + 2]);
      put(vx, z, vy, block, true);
      if (z - 1 >= 0) put(vx, z - 1, vy, block, false); // épaisseur 2 vers le fond
    }
  }
  const blocks = [];
  for (const [key, col] of byCol) {
    const [x, z] = key.split(',').map(Number);
    const minY = Math.min(...col.keys());
    const bottom = col.get(minY);
    for (let y = 0; y < minY; y++) blocks.push({ x, y, z, block: bottom });
    for (const [y, block] of col) blocks.push({ x, y, z, block });
  }
  return blocks;
}

module.exports = { voxelizeScene };

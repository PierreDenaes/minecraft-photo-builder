function composite(sceneBlocks, buildingBlocks, { x1, x2, zAnchor }) {
  let maxBX = 0, maxBZ = 0;
  for (const b of buildingBlocks) {
    maxBX = Math.max(maxBX, b.x);
    maxBZ = Math.max(maxBZ, b.z);
  }
  const zMin = zAnchor - maxBZ - 1;
  const zMax = zAnchor + 1;
  const inZone = (b) => b.x >= x1 && b.x <= x2 && b.y >= 1 && b.z >= zMin && b.z <= zMax;
  const kept = sceneBlocks.filter((b) => !inZone(b));
  const offX = x1 + Math.max(0, Math.floor((x2 - x1 + 1 - (maxBX + 1)) / 2));
  const offZ = zAnchor - maxBZ;
  const placed = buildingBlocks.map((b) => ({ x: b.x + offX, y: b.y + 1, z: b.z + offZ, block: b.block }));
  return kept.concat(placed);
}

module.exports = { composite };

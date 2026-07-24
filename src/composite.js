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
  // Clamp de sécurité : zAnchor peut être négatif si le bâtiment détecté par la
  // vision est plus profond que la scène disponible
  const offZ = Math.max(0, zAnchor - maxBZ);
  const placed = [];
  let dropped = 0;
  for (const b of buildingBlocks) {
    const y = b.y + 1;
    // Les LLM (mode code) glissent parfois des coordonnées négatives (débord de
    // toit, escalier qui remonte au-dessus du plancher haut) : on les écarte
    // proprement au lieu de faire échouer la validation
    if (y < 0) { dropped++; continue; }
    placed.push({ x: b.x + offX, y, z: b.z + offZ, block: b.block });
  }
  if (dropped > 0) console.warn(`[composite] ${dropped} bloc(s) à y<0 écarté(s) du bâtiment`);
  return kept.concat(placed);
}

module.exports = { composite };

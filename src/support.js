// Gravité : ne garder que les blocs connectés (6-adjacence) à la couche la plus basse
function enforceSupport(blocks) {
  if (blocks.length === 0) return { blocks: [], removed: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  const all = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  const minY = Math.min(...blocks.map((b) => b.y));
  const kept = new Set();
  const queue = [];
  for (const b of blocks) {
    if (b.y === minY) {
      const k = key(b.x, b.y, b.z);
      kept.add(k);
      queue.push([b.x, b.y, b.z]);
    }
  }
  while (queue.length) {
    const [x, y, z] = queue.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nk = key(x + dx, y + dy, z + dz);
      if (all.has(nk) && !kept.has(nk)) {
        kept.add(nk);
        queue.push([x + dx, y + dy, z + dz]);
      }
    }
  }
  const out = blocks.filter((b) => kept.has(key(b.x, b.y, b.z)));
  // Garde-fou : si la couche de base est un artefact (voxel bas isolé), la quasi-totalité
  // du bâtiment serait « flottante » — mieux vaut tout conserver que proposer un moignon
  if (out.length < blocks.length * 0.25) {
    console.warn('[support] couche de base anormale — structure conservée telle quelle');
    return { blocks, removed: 0 };
  }
  return { blocks: out, removed: blocks.length - out.length };
}

module.exports = { enforceSupport };

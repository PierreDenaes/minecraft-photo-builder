// Gravité : ne garder que les blocs connectés (6-adjacence) à la couche la plus basse
function enforceSupport(blocks) {
  if (blocks.length === 0) return { blocks: [], removed: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  const all = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  let minY = Infinity;
  for (const b of blocks) if (b.y < minY) minY = b.y;
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
    return { blocks, removed: 0, guard: true };
  }
  return { blocks: out, removed: blocks.length - out.length, guard: false };
}

// Rotation 90° horaire vue de dessus : est→nord→ouest→sud→est
// (cohérent avec la transposition (x,z) → (z, maxX − x))
const ROT_Y_DIR = { east: 'north', north: 'west', west: 'south', south: 'east' };
function rotateBlockStateY(block) {
  if (!block.includes('[')) return block;
  return block
    // facing des stairs, portes, wall_torch...
    .replace(/facing=(north|south|east|west)/, (_, f) => `facing=${ROT_Y_DIR[f]}`)
    // propriétés directionnelles booléennes (vine[south=true]...)
    .replace(/\b(north|south|east|west)=/g, (_, d) => `${ROT_Y_DIR[d]}=`)
    // axe des logs couchés
    .replace(/axis=(x|z)/, (_, a) => `axis=${a === 'x' ? 'z' : 'x'}`);
}

// Pivot de 90° autour de la verticale : (x,z) → (z, maxX − x)
function rotateY(blocks) {
  let maxX = 0;
  for (const b of blocks) if (b.x > maxX) maxX = b.x;
  return blocks.map((b) => ({ ...b, x: b.z, z: maxX - b.x, block: rotateBlockStateY(b.block) }));
}

// Redressement 90° autour de l'axe horizontal x : (y,z) → (z, maxY − y)
// Limitation connue : les états de blocs (facing/half) ne sont pas réorientés
// par la rotation verticale — acceptable, !redresser sert aux modèles scannés
// dont les blocs n'ont pas d'états.
function rotateX(blocks) {
  let maxY = 0;
  for (const b of blocks) if (b.y > maxY) maxY = b.y;
  return blocks.map((b) => ({ ...b, y: b.z, z: maxY - b.y }));
}

module.exports = { enforceSupport, rotateY, rotateX };

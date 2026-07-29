// Gravité : ne garder que les blocs connectés (6-adjacence) à la couche la plus basse
function enforceSupport(blocks) {
  if (blocks.length === 0) return { blocks: [], removed: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  // Les blocs 'air' explicites (tunnels d'arche, trémies) ne sont NI porteurs
  // NI élagables : ils sont exclus du graphe et toujours conservés en sortie
  const solids = blocks.filter((b) => b.block !== 'air');
  const airs = blocks.filter((b) => b.block === 'air');
  if (solids.length === 0) return { blocks, removed: 0, guard: true };
  const all = new Set(solids.map((b) => key(b.x, b.y, b.z)));
  let minY = Infinity;
  for (const b of solids) if (b.y < minY) minY = b.y;
  const kept = new Set();
  const queue = [];
  for (const b of solids) {
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
  const out = solids.filter((b) => kept.has(key(b.x, b.y, b.z)));
  // Garde-fou : si la couche de base est un artefact (voxel bas isolé), la quasi-totalité
  // du bâtiment serait « flottante » — mieux vaut tout conserver que proposer un moignon
  if (out.length < solids.length * 0.25) {
    console.warn('[support] couche de base anormale — structure conservée telle quelle');
    return { blocks, removed: 0, guard: true };
  }
  return { blocks: out.concat(airs), removed: solids.length - out.length, guard: false };
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

// Auto-oriente une structure PLATE (fresque !portrait, dans le plan X-Y, face
// vers -Z) pour qu'elle fasse face au joueur quel que soit son regard.
// Sans ça, la fresque n'est de face que si le joueur regarde nord/sud au !go ;
// s'il regarde est/ouest il en voit la tranche. Convention regard mineflayer :
// (dx, dz) = (-sin yaw, -cos yaw). Si l'axe X domine le regard → rotation 90°
// (rotateY, qui réoriente aussi les états de blocs) pour rendre la fresque fine sur X.
function orientFacingPlayer(blocks, yaw) {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return rotateY(blocks);
  return blocks;
}

module.exports = { enforceSupport, rotateY, rotateX, orientFacingPlayer };

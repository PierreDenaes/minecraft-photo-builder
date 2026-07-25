// Layouts déterministes de mobilier par rôle de pièce.
// Contrat : layout(room) → [{x, y, z, block}]. room = { cells, wallDirAt(x,z),
// doorFrontsSet, y, occupied, dims }. Chaque layout garantit :
//   - jamais sur un mur (occupied.has interdit)
//   - jamais devant la porte (doorFrontsSet interdit à y=room.y)
//   - ≤ 10 meubles au sol par pièce (parcimonie)
//   - éclairage plafond (chain + lantern) sauf pour styles rustique/médiéval
//     qui gardent wall_torch (choix hors périmètre : ici toujours plafond)

const FACING_AWAY = { '1,0': 'west', '-1,0': 'east', '0,1': 'north', '0,-1': 'south' };
const FACING_TOWARD = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };

function cellsWithWall(room) {
  return room.cells
    .map((c) => ({ ...c, w: room.wallDirAt(c.x, c.z) }))
    .filter((c) => c.w && !room.doorFrontsSet.has(`${c.x},${c.z}`))
    .sort((a, b) => a.z - b.z || a.x - b.x);
}

// Trouve le y du plafond au-dessus d'une case (premier bloc occupé en montant)
function ceilingY(room, cx, cz) {
  for (let y = room.y + 1; y < room.y + 10; y++) {
    if (room.occupied.has(`${cx},${y},${cz}`)) return y;
  }
  return null;
}

// Éclairage plafond : lantern suspendue COLLÉE au plafond (y = ceiling-1).
// fixAttachments détecte le plafond au-dessus et convertit en hanging=true.
function ceilingLights(room, count = 2) {
  const out = [];
  const inner = room.cells.filter((c) => !room.doorFrontsSet.has(`${c.x},${c.z}`));
  if (inner.length === 0) return out;
  const step = Math.max(1, Math.floor(inner.length / (count + 1)));
  for (let i = 1; i <= count; i++) {
    const c = inner[i * step];
    if (!c) continue;
    const ceil = ceilingY(room, c.x, c.z);
    if (ceil === null || ceil <= room.y) continue;
    out.push({ x: c.x, y: ceil - 1, z: c.z, block: 'lantern' });
  }
  return out;
}

// Trouve un mur "long" (le plus de cases adjacentes consécutives). Utile pour
// bibliothèque (bookshelf en série) et lit (contre mur de fond).
function longestWallRun(room) {
  const bySide = { nord: [], sud: [], est: [], ouest: [] };
  for (const c of cellsWithWall(room)) {
    const [dx, dz] = c.w;
    const side = dz === -1 ? 'sud' : dz === 1 ? 'nord' : dx === -1 ? 'est' : 'ouest';
    bySide[side].push(c);
  }
  let best = { side: null, cells: [] };
  for (const [side, arr] of Object.entries(bySide)) {
    // trouve la plus longue séquence contiguë
    arr.sort((a, b) => (side === 'nord' || side === 'sud' ? a.x - b.x : a.z - b.z));
    let run = [];
    for (const c of arr) {
      if (run.length === 0) run.push(c);
      else {
        const prev = run[run.length - 1];
        const axis = side === 'nord' || side === 'sud' ? 'x' : 'z';
        if (c[axis] === prev[axis] + 1) run.push(c);
        else {
          if (run.length > best.cells.length) best = { side, cells: [...run] };
          run = [c];
        }
      }
    }
    if (run.length > best.cells.length) best = { side, cells: run };
  }
  return best;
}

function layoutChambre(room) {
  const out = [];
  const wall = longestWallRun(room);
  if (wall.cells.length >= 2) {
    // lit sur le milieu du mur le plus long, tête AU MUR (part=head côté mur)
    const mid = wall.cells[Math.floor(wall.cells.length / 2) - 1] || wall.cells[0];
    const [dx, dz] = mid.w;
    const foot = { x: mid.x - dx, z: mid.z - dz };
    if (!room.doorFrontsSet.has(`${foot.x},${foot.z}`) && !room.doorFrontsSet.has(`${mid.x},${mid.z}`)) {
      const facing = FACING_AWAY[`${dx},${dz}`]; // pied regarde vers le centre
      out.push({ x: mid.x, y: room.y, z: mid.z, block: `red_bed[facing=${facing},part=head]` });
      out.push({ x: foot.x, y: room.y, z: foot.z, block: `red_bed[facing=${facing},part=foot]` });
    }
  }
  // rangement contre un autre mur
  const others = cellsWithWall(room).filter((c) => !out.some((o) => o.x === c.x && o.z === c.z));
  if (others[0]) out.push({ x: others[0].x, y: room.y, z: others[0].z, block: 'barrel' });
  if (others[2]) out.push({ x: others[2].x, y: room.y, z: others[2].z, block: 'flower_pot' });
  out.push(...ceilingLights(room, 1));
  return out;
}

function layoutCuisine(room) {
  const out = [];
  const spots = cellsWithWall(room);
  // groupe cuisine : furnace + smoker + crafting_table + barrel en série sur un mur
  const kit = ['furnace', 'smoker', 'crafting_table', 'barrel'];
  for (let i = 0; i < Math.min(kit.length, spots.length); i++) {
    out.push({ x: spots[i].x, y: room.y, z: spots[i].z, block: kit[i] });
  }
  out.push(...ceilingLights(room, 2));
  return out;
}

function layoutBibliotheque(room) {
  const out = [];
  const wall = longestWallRun(room);
  // bookshelf sur tout le mur long
  const cap = Math.min(wall.cells.length, 6);
  for (let i = 0; i < cap; i++) {
    out.push({ x: wall.cells[i].x, y: room.y, z: wall.cells[i].z, block: 'bookshelf' });
  }
  // 1 crafting_table de lecture sur un autre mur
  const others = cellsWithWall(room).filter((c) => !out.some((o) => o.x === c.x && o.z === c.z));
  if (others[0]) out.push({ x: others[0].x, y: room.y, z: others[0].z, block: 'crafting_table' });
  out.push(...ceilingLights(room, 1));
  return out;
}

function layoutSalon(room) {
  const out = [];
  // 2 sièges (stairs) contre un mur, orientés vers le centre + 1 flower_pot
  const spots = cellsWithWall(room);
  if (spots[0] && spots[1]) {
    for (const c of [spots[0], spots[1]]) {
      const [dx, dz] = c.w;
      const facing = FACING_AWAY[`${dx},${dz}`];
      out.push({ x: c.x, y: room.y, z: c.z, block: `oak_stairs[facing=${facing},half=bottom]` });
    }
  }
  if (spots[3]) out.push({ x: spots[3].x, y: room.y, z: spots[3].z, block: 'flower_pot' });
  if (spots[5]) out.push({ x: spots[5].x, y: room.y, z: spots[5].z, block: 'barrel' });
  out.push(...ceilingLights(room, 2));
  return out;
}

function layoutSalleAManger(room) {
  const out = [];
  // table centrale = 1 slab (ou 2 alignés), 4 chaises orientées vers la table
  const cs = room.cells.filter((c) => !room.doorFrontsSet.has(`${c.x},${c.z}`));
  if (cs.length === 0) return out;
  const center = cs[Math.floor(cs.length / 2)];
  out.push({ x: center.x, y: room.y, z: center.z, block: 'oak_slab[type=top]' });
  // 4 chaises orientées vers la table
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cx = center.x + dx;
    const cz = center.z + dz;
    if (room.occupied.has(`${cx},${room.y},${cz}`)) continue; // mur
    if (room.doorFrontsSet.has(`${cx},${cz}`)) continue;
    // chaise regarde vers la table = facing opposé de sa position par rapport à la table
    const facing = FACING_TOWARD[`${-dx},${-dz}`];
    out.push({ x: cx, y: room.y, z: cz, block: `oak_stairs[facing=${facing},half=bottom]` });
  }
  out.push(...ceilingLights(room, 2));
  return out;
}

function layoutChapelle(room) {
  const out = [];
  // pas de lit, autel central (2 slabs), candles autour, lanterne au plafond
  const cs = room.cells.filter((c) => !room.doorFrontsSet.has(`${c.x},${c.z}`));
  if (cs.length === 0) return out;
  const center = cs[Math.floor(cs.length / 2)];
  out.push({ x: center.x, y: room.y, z: center.z, block: 'stone_slab[type=top]' });
  out.push({ x: center.x, y: room.y + 1, z: center.z, block: 'candle' });
  // 2 candles supplémentaires en flanc
  const spots = cellsWithWall(room);
  if (spots[0]) out.push({ x: spots[0].x, y: room.y, z: spots[0].z, block: 'candle' });
  if (spots[2]) out.push({ x: spots[2].x, y: room.y, z: spots[2].z, block: 'candle' });
  out.push(...ceilingLights(room, 2));
  return out;
}

function layoutForge(room) {
  const out = [];
  const spots = cellsWithWall(room);
  // furnace + anvil + smoker en série, chest de rangement
  const kit = ['furnace', 'anvil', 'smoker', 'chest'];
  for (let i = 0; i < Math.min(kit.length, spots.length); i++) {
    out.push({ x: spots[i].x, y: room.y, z: spots[i].z, block: kit[i] });
  }
  out.push(...ceilingLights(room, 1));
  return out;
}

function layoutAtelier(room) {
  const out = [];
  const spots = cellsWithWall(room);
  const kit = ['crafting_table', 'barrel', 'chest', 'smoker'];
  for (let i = 0; i < Math.min(kit.length, spots.length); i++) {
    out.push({ x: spots[i].x, y: room.y, z: spots[i].z, block: kit[i] });
  }
  out.push(...ceilingLights(room, 2));
  return out;
}

function layoutEntree(room) {
  const out = [];
  const spots = cellsWithWall(room);
  if (spots[0]) out.push({ x: spots[0].x, y: room.y, z: spots[0].z, block: 'barrel' });
  if (spots[1]) out.push({ x: spots[1].x, y: room.y, z: spots[1].z, block: 'flower_pot' });
  out.push(...ceilingLights(room, 1));
  return out;
}

function layoutFallback(room) {
  const out = [];
  const spots = cellsWithWall(room);
  // 3-4 meubles génériques
  const kit = ['barrel', 'crafting_table', 'flower_pot', 'bookshelf'];
  for (let i = 0; i < Math.min(kit.length, spots.length); i += 2) {
    out.push({ x: spots[i].x, y: room.y, z: spots[i].z, block: kit[i / 2 | 0] });
  }
  out.push(...ceilingLights(room, 1));
  return out;
}

const ROLE_LAYOUTS = {
  chambre: layoutChambre,
  cuisine: layoutCuisine,
  bibliotheque: layoutBibliotheque,
  salon: layoutSalon,
  salle_a_manger: layoutSalleAManger,
  chapelle: layoutChapelle,
  forge: layoutForge,
  atelier: layoutAtelier,
  entree: layoutEntree
};

function layoutFor(role, room) {
  const fn = ROLE_LAYOUTS[role] || layoutFallback;
  return fn(room);
}

module.exports = { layoutFor, ROLE_LAYOUTS };

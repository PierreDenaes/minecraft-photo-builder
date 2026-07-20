
function detectFloors(building) {
  if (building.length === 0) return [];
  const d = dimsOf(building);
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const perY = new Map();
  for (const b of building) {
    // un plancher est une surface de MARCHE : bloc avec de l'air au-dessus
    if (occ.has(`${b.x},${b.y + 1},${b.z}`)) continue;
    perY.set(b.y, (perY.get(b.y) || 0) + 1);
  }
  const footprint = d.x * d.z;
  const floors = [];
  for (let y = 0; y < d.y; y++) {
    if ((perY.get(y) || 0) >= footprint * 0.3) {
      if (floors.length === 0 || y - floors[floors.length - 1] >= 3) floors.push(y);
    }
  }
  return floors;
}

// Inversion des responsabilités : le LLM choisit la SÉMANTIQUE (quel mobilier
// par pièce), ce module calcule les POSITIONS de façon déterministe.

function dimsOf(blocks) {
  const d = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    d.x = Math.max(d.x, b.x + 1);
    d.y = Math.max(d.y, b.y + 1);
    d.z = Math.max(d.z, b.z + 1);
  }
  return d;
}

// Une cellule de pièce : sol présent à fy, libre sur 2 blocs au-dessus
function isRoomCell(occ, x, fy, z) {
  return occ.has(`${x},${fy},${z}`) && !occ.has(`${x},${fy + 1},${z}`) && !occ.has(`${x},${fy + 2},${z}`);
}

// Une case encadrée par deux murs opposés est un PASSAGE (porte, couloir de 1) :
// elle relie les pièces mais n'en fait partie d'aucune
function isPassage(occ, x, fy, z) {
  return (occ.has(`${x - 1},${fy + 1},${z}`) && occ.has(`${x + 1},${fy + 1},${z}`))
    || (occ.has(`${x},${fy + 1},${z - 1}`) && occ.has(`${x},${fy + 1},${z + 1}`));
}

// Pièces = composantes connexes (4-adjacence) des cellules de sol libres d'un plancher
function detectRooms(building) {
  const d = dimsOf(building);
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const rooms = [];
  for (const fy of detectFloors(building)) {
    if (fy + 2 >= d.y) continue; // toit-terrasse
    const seen = new Set();
    for (let x = 0; x < d.x; x++) {
      for (let z = 0; z < d.z; z++) {
        const k = `${x},${z}`;
        if (seen.has(k) || !isRoomCell(occ, x, fy, z) || isPassage(occ, x, fy, z)) continue;
        const cells = [];
        const queue = [[x, z]];
        seen.add(k);
        while (queue.length > 0) {
          const [cx, cz] = queue.pop();
          cells.push({ x: cx, z: cz });
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx;
            const nz = cz + dz;
            const nk = `${nx},${nz}`;
            if (nx < 0 || nz < 0 || nx >= d.x || nz >= d.z || seen.has(nk)) continue;
            if (!isRoomCell(occ, nx, fy, nz) || isPassage(occ, nx, fy, nz)) continue;
            seen.add(nk);
            queue.push([nx, nz]);
          }
        }
        if (cells.length >= 6) rooms.push({ y: fy, cells });
      }
    }
  }
  return rooms;
}

const FACING_AWAY = { '1,0': 'west', '-1,0': 'east', '0,1': 'north', '0,-1': 'south' };
const LIGHT_SPACING = 5;

// Placement déterministe : mobilier contre les murs, éclairage mural espacé,
// passages (cases devant les ouvertures) toujours libres
function furnishRooms(building, rooms, sets) {
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const decor = [];
  const placed = new Set();
  rooms.forEach((room, ri) => {
    const set = sets[ri];
    if (!set || !Array.isArray(set.meubles) || set.meubles.length === 0) return;
    const fy = room.y;
    const inRoom = new Set(room.cells.map((c) => `${c.x},${c.z}`));
    const wallDir = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) =>
      occ.has(`${c.x + dx},${fy + 1},${c.z + dz}`));
    // une case est un PASSAGE si un voisin hors pièce est traversable (ouverture 1x2)
    const isDoorway = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const nx = c.x + dx;
      const nz = c.z + dz;
      if (inRoom.has(`${nx},${nz}`)) return false;
      return !occ.has(`${nx},${fy + 1},${nz}`) && !occ.has(`${nx},${fy + 2},${nz}`);
    });
    const doorFronts = new Set();
    for (const c of room.cells) {
      if (isDoorway(c)) {
        doorFronts.add(`${c.x},${c.z}`);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) doorFronts.add(`${c.x + dx},${c.z + dz}`);
      }
    }
    const spots = room.cells
      .filter((c) => wallDir(c) && !doorFronts.has(`${c.x},${c.z}`))
      .sort((a, b) => a.z - b.z || a.x - b.x);
    // éclairage mural : une wall_torch tous les LIGHT_SPACING spots
    let since = LIGHT_SPACING;
    for (const c of spots) {
      if (since >= LIGHT_SPACING) {
        decor.push({ x: c.x, y: fy + 2, z: c.z, block: 'wall_torch' });
        since = 0;
      } else {
        since++;
      }
    }
    // mobilier : un meuble un spot sur deux, plafond de 20 par pièce
    let mi = 0;
    let count = 0;
    for (let si = 0; si < spots.length && count < Math.min(20, set.meubles.length * 3); si += 2) {
      const c = spots[si];
      const key = `${c.x},${fy + 1},${c.z}`;
      if (placed.has(key)) continue;
      const meuble = set.meubles[mi % set.meubles.length];
      mi++;
      let block = meuble;
      if (/_bed$/.test(meuble)) {
        const w = wallDir(c);
        block = `${meuble}[facing=${FACING_AWAY[`${w[0]},${w[1]}`]},part=foot]`;
        // tête au mur : le pied s'écarte d'une case si possible (fixAttachments complète)
      }
      decor.push({ x: c.x, y: fy + 1, z: c.z, block });
      placed.add(key);
      count++;
    }
  });
  return decor;
}

module.exports = { detectFloors, detectRooms, furnishRooms, dimsOf };

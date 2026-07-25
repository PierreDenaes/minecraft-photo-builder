

// Masque du BÂTIMENT PRINCIPAL : plus grande composante connexe des colonnes
// « hautes » (un bloc à y >= 4). Piscines, terrasses et dallages n'en font pas
// partie — tous les raisonnements d'habitabilité s'appuient sur ce masque.
function mainBuilding(blocks, minHeight = 4) {
  const d = dimsOf(blocks);
  const tall = new Set();
  for (const b of blocks) if (b.y >= minHeight) tall.add(`${b.x},${b.z}`);
  const allCols = new Set(blocks.map((b) => `${b.x},${b.z}`));
  if (tall.size < 20) {
    // petit bâtiment bas : le masque est l'emprise entière
    let box = { x1: 0, x2: d.x - 1, z1: 0, z2: d.z - 1 };
    return { columns: allCols, box };
  }
  const seen = new Set();
  let best = [];
  for (const start of tall) {
    if (seen.has(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const cur = queue.pop();
      comp.push(cur);
      const [cx, cz] = cur.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cx + dx},${cz + dz}`;
        if (!seen.has(nk) && tall.has(nk)) { seen.add(nk); queue.push(nk); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const columns = new Set(best);
  const box = { x1: Infinity, x2: -Infinity, z1: Infinity, z2: -Infinity };
  for (const k of columns) {
    const [x, z] = k.split(',').map(Number);
    box.x1 = Math.min(box.x1, x); box.x2 = Math.max(box.x2, x);
    box.z1 = Math.min(box.z1, z); box.z2 = Math.max(box.z2, z);
  }
  return { columns, box };
}

function detectFloors(building) {
  if (building.length === 0) return [];
  const d = dimsOf(building);
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const mask = mainBuilding(building);
  const perY = new Map();
  for (const b of building) {
    if (!mask.columns.has(`${b.x},${b.z}`)) continue; // hors bâtiment principal
    // un plancher est une surface de MARCHE : bloc avec de l'air au-dessus
    if (occ.has(`${b.x},${b.y + 1},${b.z}`)) continue;
    perY.set(b.y, (perY.get(b.y) || 0) + 1);
  }
  const footprint = mask.columns.size;
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
  const mask = mainBuilding(building);
  const rooms = [];
  for (const fy of detectFloors(building)) {
    if (fy + 2 >= d.y) continue; // toit-terrasse
    const seen = new Set();
    for (let x = 0; x < d.x; x++) {
      for (let z = 0; z < d.z; z++) {
        const k = `${x},${z}`;
        if (seen.has(k) || !mask.columns.has(k) || !isRoomCell(occ, x, fy, z) || isPassage(occ, x, fy, z)) continue;
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
            if (!mask.columns.has(nk) || !isRoomCell(occ, nx, fy, nz) || isPassage(occ, nx, fy, nz)) continue;
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

const { layoutFor } = require('./roomlayouts');

// Placement déterministe : le LLM (Haiku) choisit le RÔLE de chaque pièce
// (chambre/cuisine/bibliothèque/salon/salle_a_manger/chapelle/forge/atelier/entree),
// un layout par rôle place le mobilier avec circulation garantie et éclairage plafond.
function furnishRooms(building, rooms, sets) {
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const decor = [];
  rooms.forEach((room, ri) => {
    const set = sets[ri];
    if (!set || !set.role) return;
    const fy = room.y;
    const y = fy + 1;
    const inRoom = new Set(room.cells.map((c) => `${c.x},${c.z}`));
    const wallDirAt = (x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) =>
      occ.has(`${x + dx},${y},${z + dz}`));
    // passages
    const isDoorway = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const nx = c.x + dx;
      const nz = c.z + dz;
      if (inRoom.has(`${nx},${nz}`)) return false;
      return !occ.has(`${nx},${y},${nz}`) && !occ.has(`${nx},${y + 1},${nz}`);
    });
    const doorFrontsSet = new Set();
    for (const c of room.cells) {
      if (isDoorway(c)) {
        doorFrontsSet.add(`${c.x},${c.z}`);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) doorFrontsSet.add(`${c.x + dx},${c.z + dz}`);
      }
    }
    const roomCtx = { cells: room.cells, wallDirAt, doorFrontsSet, y, occupied: occ, dims: { w: 0, d: 0 } };
    for (const b of layoutFor(set.role, roomCtx)) decor.push(b);
  });
  return decor;
}

module.exports = { detectFloors, detectRooms, furnishRooms, dimsOf, mainBuilding };

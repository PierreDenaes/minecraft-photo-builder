const { test } = require('node:test');
const assert = require('node:assert');
const { detectRooms, furnishRooms } = require('../src/rooms');

// bâtiment 2 pièces : dalle y0, plafond y5, murs périmètre + cloison x=7 percée d'une porte (z=4)
function twoRooms() {
  const blocks = [];
  const put = (x, y, z, block = 'stone_bricks') => blocks.push({ x, y, z, block });
  for (let x = 0; x < 15; x++) for (let z = 0; z < 9; z++) { put(x, 0, z, 'oak_planks'); put(x, 5, z); }
  for (let y = 1; y < 5; y++) {
    for (let x = 0; x < 15; x++) { put(x, y, 0); put(x, y, 8); }
    for (let z = 0; z < 9; z++) { put(0, y, z); put(14, y, z); }
    for (let z = 1; z < 8; z++) if (!(z === 4 && y <= 2)) put(7, y, z); // cloison avec porte 1x2 en z=4
  }
  return blocks.filter((b, i, a) => a.findIndex((c) => c.x === b.x && c.y === b.y && c.z === b.z) === i);
}

test('detectRooms : deux pièces séparées par la cloison', () => {
  const rooms = detectRooms(twoRooms());
  assert.strictEqual(rooms.length, 2);
  assert.ok(rooms.every((r) => r.y === 0));
  const sizes = rooms.map((r) => r.cells.length).sort((a, b) => a - b);
  assert.ok(sizes[0] >= 6 && sizes[1] >= 6);
  // aucune cellule de pièce sur un mur
  for (const r of rooms) for (const c of r.cells) assert.ok(c.x !== 7 || c.z === 4);
});

test('furnishRooms : layouts par rôle appliqués, pas de meubles devant les portes', () => {
  const building = twoRooms();
  const rooms = detectRooms(building);
  const sets = rooms.map((_, i) => ({ role: i === 0 ? 'chambre' : 'atelier' }));
  const decor = furnishRooms(building, rooms, sets);
  assert.ok(decor.length > 0);
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  for (const b of decor) {
    assert.ok(!occ.has(`${b.x},${b.y},${b.z}`), 'collision structure');
    // devant la porte (7,1-2,4) : cases (6,4) et (8,4) au sol libres
    assert.ok(!((b.x === 6 || b.x === 8) && b.z === 4 && b.y <= 2), `meuble devant la porte : ${JSON.stringify(b)}`);
  }
  // éclairage plafond : chain OU lantern présents au-dessus du sol
  const lights = decor.filter((b) => /lantern|chain|torch/.test(b.block));
  assert.ok(lights.length >= 1, `éclairage attendu : ${lights.length}`);
  // parcimonie
  assert.ok(decor.length <= 40, `parcimonie : ${decor.length} blocs`);
});

// ---- masque du bâtiment principal ----
const { mainBuilding, detectFloors } = require('../src/rooms');

// scène : maison 12x9 (murs y1-7, dalle y0+y4+toit y8) + piscine plate 20x14 accolée
function houseWithPool() {
  const out = [];
  const put = (x, y, z, block = 'white_concrete') => out.push({ x, y, z, block });
  for (let x = 0; x < 12; x++) for (let z = 0; z < 9; z++) {
    put(x, 0, z, 'smooth_stone'); put(x, 4, z, 'oak_planks'); put(x, 8, z, 'light_gray_concrete');
  }
  for (let y = 1; y < 8; y++) {
    for (let x = 0; x < 12; x++) { put(x, y, 0); put(x, y, 8); }
    for (let z = 0; z < 9; z++) { put(0, y, z); put(11, y, z); }
  }
  // piscine et terrasse basses (y0-1) qui étendent la bbox jusqu'à x=39, z=22
  for (let x = 14; x < 40; x++) for (let z = 0; z < 23; z++) {
    put(x, 0, z, 'smooth_stone');
    if (x > 20 && x < 34 && z > 4 && z < 16) put(x, 1, z, 'water');
  }
  return out.filter((b) => !(b.z === 0 && b.x === 5 && (b.y === 1 || b.y === 2))); // porte
}

test('mainBuilding isole la maison, pas la piscine', () => {
  const scene = houseWithPool();
  const mask = mainBuilding(scene);
  assert.ok(mask.columns.has('5,4'), 'colonne intérieure maison');
  assert.ok(!mask.columns.has('25,10'), 'colonne piscine exclue');
  assert.ok(mask.box.x2 <= 12);
});

test('detectFloors voit l\'étage de la maison malgré la piscine qui dilue l\'emprise', () => {
  const floors = detectFloors(houseWithPool());
  assert.ok(floors.includes(0));
  assert.ok(floors.includes(4), `étage y=4 attendu : ${floors}`);
});

test('detectFloors : ne détecte PAS les linteaux de baies comme planchers', () => {
  const out = [];
  const put = (x, y, z, block = 'white_concrete') => out.push({ x, y, z, block });
  // boite 10x8, y0=0 y1=6 (dalle basse + plancher haut)
  for (let x = 0; x < 10; x++) for (let z = 0; z < 8; z++) {
    put(x, 0, z); put(x, 6, z);
  }
  for (let y = 1; y < 6; y++) {
    for (let x = 0; x < 10; x++) { put(x, y, 0); put(x, y, 7); }
    for (let z = 0; z < 8; z++) { put(0, y, z); put(9, y, z); }
  }
  // baies sur la façade sud (z=0), linteau à y=4 sur x=2..7 (6 linteaux)
  for (let x = 2; x < 8; x++) {
    put(x, 4, 0, 'oak_log'); // linteau
    // vitres y=1..3 (l'air remplace le mur)
    for (let y = 1; y <= 3; y++) out.push({ x, y, z: 0, block: 'glass_pane' });
  }
  const floors = detectFloors(out);
  // Vrais planchers = y=0 (dalle basse) et y=6 (plancher haut). Le linteau y=4
  // NE doit PAS être détecté comme plancher.
  assert.ok(!floors.includes(4), `linteau y=4 détecté comme plancher : ${floors}`);
  assert.ok(floors.includes(0));
});

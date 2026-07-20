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

test('furnishRooms : meubles contre les murs, jamais devant la porte, éclairage mural espacé', () => {
  const building = twoRooms();
  const rooms = detectRooms(building);
  const sets = rooms.map((_, i) => ({ role: i === 0 ? 'chambre' : 'atelier', meubles: ['red_bed', 'barrel', 'bookshelf', 'crafting_table'] }));
  const decor = furnishRooms(building, rooms, sets);
  assert.ok(decor.length > 0);
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const wallAdj = (b) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => occ.has(`${b.x + dx},${b.y},${b.z + dz}`));
  for (const b of decor) {
    assert.ok(!occ.has(`${b.x},${b.y},${b.z}`), 'collision structure');
    // devant la porte (7,1-2,4) : cases (6,4) et (8,4) au sol libres
    assert.ok(!((b.x === 6 || b.x === 8) && b.z === 4 && b.y <= 2), `meuble devant la porte : ${JSON.stringify(b)}`);
  }
  // mobilier au sol contre un mur
  const meubles = decor.filter((b) => b.y === 1 && !/torch/.test(b.block));
  assert.ok(meubles.length > 0);
  for (const m of meubles) assert.ok(wallAdj(m), `meuble loin des murs : ${JSON.stringify(m)}`);
  // éclairage : wall_torch en hauteur (y=2 ou 3), jamais de lanterne posée au sol en plein passage
  const lights = decor.filter((b) => /torch/.test(b.block));
  assert.ok(lights.length >= 2);
  for (const l of lights) assert.ok(l.y >= 2, `éclairage au sol : ${JSON.stringify(l)}`);
  // parcimonie
  assert.ok(decor.length <= 40);
});

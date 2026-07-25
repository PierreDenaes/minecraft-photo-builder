const { test } = require('node:test');
const assert = require('node:assert');
const { layoutFor, ROLE_LAYOUTS } = require('../src/roomlayouts');

// Pièce rectangulaire 8x6 : murs pleins sur le pourtour, sol libre à l'intérieur.
// Retourne { cells: [{x,z}], wallDirAt(x,z), doorFrontsSet, y, occupied }
function makeRoom({ w = 8, d = 6, y = 1, doorAt = { x: 4, z: 0 } } = {}) {
  const occupied = new Set();
  const put = (x, yy, z) => occupied.add(`${x},${yy},${z}`);
  // dalle basse à y-1
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) put(x, y - 1, z);
  // murs à y et y+1 sur périmètre (sauf porte)
  for (let yy = y; yy <= y + 1; yy++) {
    for (let x = 0; x < w; x++) { put(x, yy, 0); put(x, yy, d - 1); }
    for (let z = 0; z < d; z++) { put(0, yy, z); put(w - 1, yy, z); }
    // porte
    occupied.delete(`${doorAt.x},${yy},${doorAt.z}`);
  }
  // plafond à y+3
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) put(x, y + 3, z);
  const cells = [];
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) cells.push({ x, z });
  const wallDirAt = (x, z) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (occupied.has(`${x + dx},${y},${z + dz}`)) return [dx, dz];
    }
    return null;
  };
  const doorFrontsSet = new Set([`${doorAt.x},${doorAt.z}`, `${doorAt.x},${doorAt.z + 1}`]);
  return { cells, wallDirAt, doorFrontsSet, y, occupied, dims: { w, d } };
}

const at = (blocks, x, y, z) => blocks.find((b) => b.x === x && b.y === y && b.z === z);
const baseOf = (n) => n.replace(/\[[^\]]*\]$/, '');

// ---- contrats communs à tous les layouts ----
for (const role of Object.keys(ROLE_LAYOUTS)) {
  test(`layout ${role} : jamais sur cases de mur, jamais devant la porte, jamais au-delà de 10 meubles`, () => {
    const room = makeRoom();
    const blocks = layoutFor(role, room);
    assert.ok(blocks.length > 0, `${role} : pièce non vide attendue`);
    assert.ok(blocks.length <= 15, `${role} : ${blocks.length} blocs > 15`);
    for (const b of blocks) {
      // jamais sur un mur
      assert.ok(!room.occupied.has(`${b.x},${b.y},${b.z}`), `${role} : collision mur à (${b.x},${b.y},${b.z}) ${b.block}`);
      // jamais devant la porte (sauf éclairage au plafond)
      if (b.y === room.y) {
        assert.ok(!room.doorFrontsSet.has(`${b.x},${b.z}`), `${role} : meuble devant porte`);
      }
    }
  });
}

// ---- signatures spécifiques par rôle ----
test('chambre : contient au moins un lit (2 blocs part=foot + part=head), tête au mur', () => {
  const b = layoutFor('chambre', makeRoom());
  const foot = b.find((k) => /_bed\[.*part=foot/.test(k.block));
  const head = b.find((k) => /_bed\[.*part=head/.test(k.block));
  assert.ok(foot && head, `pied + tête attendus : ${JSON.stringify(b.filter((k) => /_bed/.test(k.block)))}`);
});

test('cuisine : contient furnace + crafting_table + barrel groupés', () => {
  const b = layoutFor('cuisine', makeRoom());
  const noms = new Set(b.map((k) => baseOf(k.block)));
  assert.ok(noms.has('furnace'), 'furnace attendue');
  assert.ok(noms.has('crafting_table') || noms.has('smoker'), 'plan de travail attendu');
  assert.ok(noms.has('barrel'), 'barrel attendu');
});

test('bibliotheque : au moins 4 bookshelf alignés sur un mur', () => {
  const b = layoutFor('bibliotheque', makeRoom());
  const shelves = b.filter((k) => k.block === 'bookshelf');
  assert.ok(shelves.length >= 4, `bookshelf en série attendus : ${shelves.length}`);
});

test('salon : centre libre (pas de meuble à 2+ blocs du mur)', () => {
  const room = makeRoom({ w: 10, d: 8 });
  const b = layoutFor('salon', room);
  for (const meuble of b) {
    if (meuble.y !== room.y) continue;
    // les meubles sont contre les murs (distance ≤ 1)
    const dist = Math.min(meuble.x, meuble.z, room.dims.w - 1 - meuble.x, room.dims.d - 1 - meuble.z);
    assert.ok(dist <= 2, `salon : centre libre — meuble trop loin des murs (${meuble.x},${meuble.z}) dist=${dist}`);
  }
});

test('salle_a_manger : table centrale + chaises autour', () => {
  const b = layoutFor('salle_a_manger', makeRoom({ w: 9, d: 7 }));
  // table = slab au centre, chaises = stairs orientées vers la table
  assert.ok(b.some((k) => /_slab/.test(k.block)), 'table (slab) attendue');
  assert.ok(b.some((k) => /_stairs\[facing=/.test(k.block)), 'chaises (stairs) attendues');
});

test('chapelle : PAS de lit, présence de source lumineuse (lantern/candle)', () => {
  const b = layoutFor('chapelle', makeRoom({ w: 10, d: 8 }));
  assert.ok(!b.some((k) => /_bed/.test(k.block)), 'chapelle sans lit');
  assert.ok(b.some((k) => /lantern|candle|torch/.test(k.block)), 'source lumineuse attendue');
});

test('forge : furnace + anvil + smoker (atelier feu)', () => {
  const b = layoutFor('forge', makeRoom());
  const noms = new Set(b.map((k) => baseOf(k.block)));
  assert.ok(noms.has('furnace'), 'furnace attendue');
});

test('atelier : crafting_table + rangement (barrel ou chest)', () => {
  const b = layoutFor('atelier', makeRoom());
  const noms = new Set(b.map((k) => baseOf(k.block)));
  assert.ok(noms.has('crafting_table'), 'crafting_table attendue');
  assert.ok(noms.has('barrel') || noms.has('chest'), 'rangement attendu');
});

test('entree : rangement minimal, pas de lit, pas de cuisine', () => {
  const b = layoutFor('entree', makeRoom());
  assert.ok(!b.some((k) => /_bed|furnace|crafting_table|bookshelf/.test(k.block)),
    `entrée sans mobilier lourd : ${b.map((k) => k.block).join(', ')}`);
});

// ---- fallback ----
test('layoutFor : rôle inconnu → fallback générique déterministe', () => {
  const b = layoutFor('inconnu', makeRoom());
  assert.ok(b.length > 0, 'fallback doit meubler la pièce');
});

test('chambre : la tête du lit est CONTRE le mur, pas dans le mur (bug facing)', () => {
  const room = makeRoom({ w: 10, d: 8 });
  const b = layoutFor('chambre', room);
  const foot = b.find((k) => /_bed\[.*part=foot/.test(k.block));
  const head = b.find((k) => /_bed\[.*part=head/.test(k.block));
  assert.ok(foot && head);
  // la tête doit être ADJACENTE au pied (distance manhattan = 1)
  const dist = Math.abs(foot.x - head.x) + Math.abs(foot.z - head.z);
  assert.strictEqual(dist, 1, `pied et tête doivent être adjacents : foot=(${foot.x},${foot.z}) head=(${head.x},${head.z}) dist=${dist}`);
  // la tête doit avoir un mur adjacent (à moins 1 sur x ou z)
  const wallAdj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => room.occupied.has(`${head.x + dx},${head.y},${head.z + dz}`));
  assert.ok(wallAdj, `tête sans mur adjacent : (${head.x},${head.z})`);
  // le facing doit être cohérent : head = foot + BED_HEAD[facing]
  const facing = /facing=(north|south|east|west)/.exec(foot.block)[1];
  const BED_HEAD = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const [dx, dz] = BED_HEAD[facing];
  assert.strictEqual(head.x, foot.x + dx, `facing=${facing} : head.x devrait être ${foot.x + dx}, est ${head.x}`);
  assert.strictEqual(head.z, foot.z + dz, `facing=${facing} : head.z devrait être ${foot.z + dz}, est ${head.z}`);
});

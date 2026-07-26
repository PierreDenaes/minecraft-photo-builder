const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { loadSchema, remapPalette, chooseSchema, listCatalog } = require('../src/schemas');

// Fixture minimale : mock d'un schema après load — [{x, y, z, block}]
function fakeSchema() {
  return {
    nom: 'test',
    style: 'moderne',
    blocks: [
      { x: 0, y: 0, z: 0, block: 'stone_bricks' },
      { x: 1, y: 0, z: 0, block: 'stone_bricks' },
      { x: 0, y: 1, z: 0, block: 'oak_planks' },
      { x: 1, y: 1, z: 0, block: 'glass_pane' }
    ]
  };
}

test('loadSchema : lit un vrai .schem existant et retourne { blocks, dims, palette }', async () => {
  // le catalogue référence les .schem de docs/schem/
  const s = await loadSchema('30732');
  assert.ok(Array.isArray(s.blocks));
  assert.ok(s.blocks.length > 0);
  assert.ok(s.dims && s.dims.x > 0 && s.dims.y > 0 && s.dims.z > 0);
  assert.ok(s.palette instanceof Set);
  // les blocs sont bien à coords >= 0 (origine à 0,0,0)
  for (const b of s.blocks) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.z >= 0, `bloc négatif : ${JSON.stringify(b)}`);
    assert.strictEqual(typeof b.block, 'string');
  }
});

test('loadSchema : erreur claire si nom absent du catalogue', async () => {
  await assert.rejects(() => loadSchema('inconnu_xyz'), /schema.*inconnu|catalogue/i);
});

test('remapPalette : remplace UN matériau par UN autre partout', () => {
  const s = fakeSchema();
  const out = remapPalette(s, { stone_bricks: 'white_concrete' });
  assert.ok(out.blocks.some((b) => b.block === 'white_concrete'));
  assert.ok(!out.blocks.some((b) => b.block === 'stone_bricks'));
  // les blocs non concernés restent inchangés
  assert.ok(out.blocks.some((b) => b.block === 'oak_planks'));
  assert.ok(out.blocks.some((b) => b.block === 'glass_pane'));
});

test('remapPalette : mapping multiple, cible = source vide → pas de changement', () => {
  const s = fakeSchema();
  const out = remapPalette(s, {});
  assert.deepStrictEqual(out.blocks.map((b) => b.block), s.blocks.map((b) => b.block));
});

test('remapPalette : préserve les états de bloc [facing=...]', () => {
  const s = { nom: 't', blocks: [{ x: 0, y: 0, z: 0, block: 'oak_stairs[facing=north,half=bottom]' }] };
  const out = remapPalette(s, { oak_stairs: 'spruce_stairs' });
  assert.strictEqual(out.blocks[0].block, 'spruce_stairs[facing=north,half=bottom]');
});

test('listCatalog : retourne les entrées du catalogue', () => {
  const cat = listCatalog();
  assert.ok(Array.isArray(cat));
  assert.ok(cat.length > 0, 'catalogue non vide attendu');
  for (const e of cat) {
    assert.ok(e.nom && e.style && e.type_batiment, `entrée mal formée : ${JSON.stringify(e)}`);
  }
});

test('chooseSchema : match direct par style + type_batiment', async () => {
  const description = { style: 'moderne', type_batiment: 'villa', dimensions_estimees: { largeur: 20, profondeur: 15, hauteur: 8 } };
  const choice = await chooseSchema(description);
  assert.ok(choice, `sélection attendue pour villa moderne`);
  assert.strictEqual(choice.style, 'moderne');
});

test('chooseSchema : STRICT — retourne null si aucun schema ne matche vraiment', async () => {
  const description = { style: 'egyptien', type_batiment: 'pyramide', dimensions_estimees: { largeur: 50, profondeur: 50, hauteur: 30 } };
  const choice = await chooseSchema(description);
  assert.strictEqual(choice, null, 'aucun schema égyptien dans le catalogue → doit refuser');
});

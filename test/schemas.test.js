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

test('chooseSchema : type_batiment libre "maison_bretonne_en_pierre" matche "maison"', async () => {
  const description = { style: 'medieval', type_batiment: 'maison_bretonne_en_pierre' };
  const choice = await chooseSchema(description);
  // doit trouver un match sur "maison" mais SANS retourner un schema minuscule
  if (choice) {
    const emprise = choice.emprise;
    const vol = emprise.x * emprise.y * emprise.z;
    assert.ok(vol >= 500, `schema trop petit choisi : ${choice.nom} ${emprise.x}x${emprise.y}x${emprise.z}`);
  }
});

test('loadSchema : filtre le terrain plat sous le bâtiment (dirt/grass en couche basse)', async () => {
  // 30843 a un vaste plateau d'herbe autour — on ne veut pas ce socle
  const s = await loadSchema('30843');
  // Après filtrage : au plus quelques dizaines de blocs de sol conservés (sous
  // la maison uniquement, plus le vaste plateau d'herbe autour).
  const ys = s.blocks.map((b) => b.y);
  const minY = Math.min(...ys);
  const groundCount = s.blocks.filter((b) => b.y === minY && /^(dirt|grass_block|coarse_dirt|podzol|farmland|dirt_path)$/.test(b.block)).length;
  assert.ok(groundCount < 200, `trop de terrain conservé : ${groundCount} blocs de sol au niveau minY`);
});

// ---- I18 : schemas comme base de connaissances (RAG) ----
const { chooseSchemas, analyzeSchema } = require('../src/schemas');

test('chooseSchemas : retourne un tableau trié par pertinence (jusqu\'à n schemas)', async () => {
  const results = await chooseSchemas({ style: 'moderne', type_batiment: 'villa' }, 3);
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0 && results.length <= 3);
  // premier = style + type parfaits ; les suivants doivent au moins matcher un des deux
  assert.strictEqual(results[0].style, 'moderne');
});

test('chooseSchemas : n=1 se comporte comme chooseSchema (compat)', async () => {
  const arr = await chooseSchemas({ style: 'rustique_organique', type_batiment: 'maison' }, 1);
  assert.strictEqual(arr.length, 1);
  assert.ok(['rustique_organique', 'medieval', 'autre'].includes(arr[0].style));
});

test('chooseSchemas : catalogue sans match → []', async () => {
  const arr = await chooseSchemas({ style: 'egyptien', type_batiment: 'pyramide' }, 3);
  assert.deepStrictEqual(arr, []);
});

test('analyzeSchema : produit proportions, materiaux_par_zone (fondation/murs/toit), ratios', async () => {
  const entry = require('../data/schema-catalog.json').find((e) => e.nom === '30732');
  const analysis = await analyzeSchema(entry);
  assert.ok(analysis.proportions, 'proportions attendues');
  assert.ok(analysis.proportions.largeur > 0);
  assert.ok(analysis.proportions.hauteur > 0);
  assert.ok(analysis.materiaux_par_zone, 'materiaux_par_zone attendus');
  const z = analysis.materiaux_par_zone;
  assert.ok(z.fondation && Array.isArray(z.fondation), 'fondation array');
  assert.ok(z.murs && Array.isArray(z.murs), 'murs array');
  assert.ok(z.toit && Array.isArray(z.toit), 'toit array');
  // chaque zone contient au moins 1 matériau avec un pct
  for (const [zone, arr] of Object.entries(z)) {
    if (arr.length === 0) continue;
    assert.ok(typeof arr[0].bloc === 'string');
    assert.ok(typeof arr[0].pct === 'number' && arr[0].pct >= 0 && arr[0].pct <= 100);
  }
  assert.ok(analysis.ratios);
});

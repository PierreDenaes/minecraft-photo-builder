const { test } = require('node:test');
const assert = require('node:assert');
const { voxelizeScene } = require('../src/voxelizer');

const colors = new Map([['stone', [128, 128, 128]], ['grass_block', [80, 160, 60]]]);

function grayImage(width, height) {
  const data = Buffer.alloc(width * height * 3, 128);
  return { data, width, height };
}

function flatDepth(value) {
  return { width: 4, height: 4, data: new Float32Array(16).fill(value) };
}

test('profondeur 0 (proche) → z maximal, épaisseur 2', () => {
  const blocks = voxelizeScene(grayImage(4, 4), flatDepth(0), { sizeX: 2, sizeZ: 4, maxY: 2, colors });
  const zs = new Set(blocks.map((b) => b.z));
  assert.deepStrictEqual([...zs].sort(), [2, 3]); // z=3 (proche) + épaisseur z=2
  assert.ok(blocks.every((b) => b.block === 'stone'));
});

test('profondeur 1 hors ciel → z minimal', () => {
  // v >= 0.45 (moitié basse) n'est jamais ciel même à profondeur 1
  const blocks = voxelizeScene(grayImage(4, 4), flatDepth(1), { sizeX: 2, sizeZ: 4, maxY: 4, colors });
  const bas = blocks.filter((b) => b.y === 0);
  assert.ok(bas.length > 0);
  assert.ok(bas.every((b) => b.z <= 1)); // loin → petit z (0 + épaisseur... z=0 uniquement, pas de z-1)
});

test('le ciel (loin + haut d\'image) ne produit aucun bloc', () => {
  const blocks = voxelizeScene(grayImage(4, 4), flatDepth(1), { sizeX: 2, sizeZ: 4, maxY: 4, colors });
  const haut = blocks.filter((b) => b.y === 3); // rangée haute : v = 0 → ciel
  assert.strictEqual(haut.length, 0);
});

test('comblement : colonne remplie jusqu\'à y=0', () => {
  // profondeur variable : moitié haute d'image loin (mais pas ciel), moitié basse proche
  const depth = { width: 2, height: 2, data: new Float32Array([0.6, 0.6, 0.1, 0.1]) };
  const blocks = voxelizeScene(grayImage(2, 2), depth, { sizeX: 1, sizeZ: 8, maxY: 4, colors });
  // les voxels bas (y=0,1) sont à z proche ; sous chaque colonne du haut (y=2,3 à z lointain), comblement jusqu'à y=0
  const colFar = blocks.filter((b) => b.z === Math.round((1 - 0.6) * 7));
  const ys = new Set(colFar.map((b) => b.y));
  for (let y = 0; y <= Math.max(...ys); y++) assert.ok(ys.has(y), `y=${y} manquant dans la colonne comblée`);
});

test('accepte une fonction de choix de bloc à la place de la table', () => {
  const blocks = voxelizeScene(grayImage(4, 4), flatDepth(0), { sizeX: 2, sizeZ: 4, maxY: 2, colors: () => 'tuff' });
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((b) => b.block === 'tuff'));
});

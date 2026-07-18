const { test } = require('node:test');
const assert = require('node:assert');
const { plantVegetation } = require('../src/vegetation');

function lawn(x1, x2, z1, z2, y = 5) {
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
    out.push({ x, y, z, block: 'grass_block' });
    out.push({ x, y: y - 1, z, block: 'dirt' });
  }
  return out;
}

test('déterministe, arbres avec tronc sur l\'herbe et houppier', () => {
  const terrain = lawn(0, 39, 0, 39);
  const a = plantVegetation(terrain, { seed: 7, densite: 0.05 });
  const b = plantVegetation(terrain, { seed: 7, densite: 0.05 });
  assert.deepStrictEqual(a, b);
  const trunks = a.filter((t) => /log$/.test(t.block));
  const leaves = a.filter((t) => /leaves$/.test(t.block));
  assert.ok(trunks.length > 0, 'aucun arbre');
  assert.ok(leaves.length > trunks.length, 'houppiers manquants');
  const bases = trunks.filter((t) => t.y === 6); // premier tronc au-dessus de l'herbe (y=5)
  assert.ok(bases.length > 0);
});

test('zone exclue (avec marge 2) sans arbres', () => {
  const terrain = lawn(0, 39, 0, 39);
  const trees = plantVegetation(terrain, { seed: 7, densite: 0.2, exclude: { x1: 10, x2: 20, z1: 10, z2: 20 } });
  assert.ok(trees.every((t) => t.x < 8 || t.x > 22 || t.z < 8 || t.z > 22 ||
    !/log$/.test(t.block) || t.x < 10 - 2 || t.x > 20 + 2 || t.z < 10 - 2 || t.z > 20 + 2));
  const trunkInZone = trees.some((t) => /log$/.test(t.block) && t.x >= 8 && t.x <= 22 && t.z >= 8 && t.z <= 22);
  assert.strictEqual(trunkInZone, false);
});

test('densité 0 : aucun arbre ; types sapin respectés', () => {
  const terrain = lawn(0, 19, 0, 19);
  assert.deepStrictEqual(plantVegetation(terrain, { seed: 1, densite: 0 }), []);
  const sapins = plantVegetation(terrain, { seed: 1, densite: 0.3, types: ['sapin'] });
  assert.ok(sapins.length > 0);
  assert.ok(sapins.every((t) => t.block === 'spruce_log' || t.block === 'spruce_leaves'));
});

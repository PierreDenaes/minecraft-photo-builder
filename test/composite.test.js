const { test } = require('node:test');
const assert = require('node:assert');
const { composite } = require('../src/composite');

const scene = [];
for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) {
  scene.push({ x, y: 0, z, block: 'grass_block' });
  scene.push({ x, y: 1, z, block: 'stone' });
}
const building = [
  { x: 0, y: 0, z: 0, block: 'oak_planks' },
  { x: 1, y: 0, z: 1, block: 'oak_planks' },
  { x: 0, y: 1, z: 0, block: 'glass_pane' }
];

test('évide la zone et conserve le sol y=0', () => {
  const out = composite(scene, building, { x1: 2, x2: 5, zAnchor: 6 });
  assert.ok(out.some((b) => b.x === 3 && b.y === 0 && b.z === 5 && b.block === 'grass_block'));
  assert.ok(!out.some((b) => b.x === 3 && b.y === 1 && b.z === 5 && b.block === 'stone'));
});

test('conserve la scène hors zone', () => {
  const out = composite(scene, building, { x1: 2, x2: 5, zAnchor: 6 });
  assert.ok(out.some((b) => b.x === 8 && b.y === 1 && b.z === 8 && b.block === 'stone'));
});

test('insère le bâtiment posé à y=1, face avant sur zAnchor, centré', () => {
  const out = composite(scene, building, { x1: 2, x2: 5, zAnchor: 6 });
  // bâtiment 2 de large sur [2..5] (4 de large) → offset x = 2 + 1 = 3 ; zMax bâtiment = 1 → offZ = 5
  assert.ok(out.some((b) => b.x === 3 && b.y === 1 && b.z === 5 && b.block === 'oak_planks'));
  assert.ok(out.some((b) => b.x === 4 && b.y === 1 && b.z === 6 && b.block === 'oak_planks'));
  assert.ok(out.some((b) => b.x === 3 && b.y === 2 && b.z === 5 && b.block === 'glass_pane'));
});

test('composite : offZ négatif clampé (zAnchor trop petit) sans blocs négatifs', () => {
  const scene = [{ x: 5, y: 0, z: 5, block: 'grass_block' }];
  const building = [{ x: 0, y: 0, z: 0, block: 'stone' }, { x: 2, y: 0, z: 2, block: 'stone' }];
  const out = composite(scene, building, { x1: 0, x2: 10, zAnchor: 1 });
  for (const b of out) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.z >= 0, `bloc négatif : ${JSON.stringify(b)}`);
  }
});

test('composite : blocs à y<0 du bâtiment filtrés (jamais négatifs en sortie)', () => {
  const scene = [];
  const building = [
    { x: 0, y: -1, z: 0, block: 'stone' },
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 0, y: 5, z: 0, block: 'wool' }
  ];
  const out = composite(scene, building, { x1: 0, x2: 5, zAnchor: 3 });
  for (const b of out) assert.ok(b.y >= 0, `y<0 : ${JSON.stringify(b)}`);
  assert.ok(out.some((b) => b.block === 'wool'));
});

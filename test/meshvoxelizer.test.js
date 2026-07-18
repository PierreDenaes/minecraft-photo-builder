const { test } = require('node:test');
const assert = require('node:assert');
const { voxelizeMesh } = require('../src/meshvoxelizer');

function quad(a, b, c, d, color = null) {
  return [{ a, b, c, color }, { a, b: c, c: d, color }];
}

// cube unité : 6 faces
function cubeTriangles() {
  const v = (x, y, z) => [x, y, z];
  return [
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)),
    ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...quad(v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)),
    ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...quad(v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1))
  ];
}

test('cube → coquille pleine aux 6 faces, mis à l\'échelle', () => {
  const blocks = voxelizeMesh(cubeTriangles(), { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone' });
  const has = (x, y, z) => blocks.some((b) => b.x === x && b.y === y && b.z === z);
  assert.ok(has(0, 0, 0));
  assert.ok(has(7, 7, 7));
  assert.ok(has(0, 3, 3)); // milieu d'une face
  assert.ok(!has(3, 3, 3)); // intérieur creux
  assert.ok(blocks.every((b) => b.block === 'stone'));
  assert.ok(blocks.every((b) => b.x >= 0 && b.x <= 7 && b.y >= 0 && b.y <= 7 && b.z >= 0 && b.z <= 7));
});

test('couleur du triangle mappée vers un bloc', () => {
  const colors = new Map([['red_concrete', [142, 32, 32]], ['stone', [125, 125, 125]]]);
  const tris = [{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], color: [255, 0, 0] }];
  const blocks = voxelizeMesh(tris, { maxX: 4, maxY: 4, maxZ: 4, defaultBlock: 'stone', colors });
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((b) => b.block === 'red_concrete'));
});

test('zUp échange hauteur et profondeur', () => {
  // triangle debout dans le plan x/z (z = vertical en convention z-up)
  const tris = [{ a: [0, 0, 0], b: [4, 0, 0], c: [0, 0, 4], color: null }];
  const flat = voxelizeMesh(tris, { maxX: 5, maxY: 5, maxZ: 5, defaultBlock: 'stone', zUp: false });
  const up = voxelizeMesh(tris, { maxX: 5, maxY: 5, maxZ: 5, defaultBlock: 'stone', zUp: true });
  assert.ok(flat.every((b) => b.y === 0));  // sans zUp : plat au sol
  assert.ok(up.some((b) => b.y > 0));       // avec zUp : vertical
});

test('accepte une fonction de choix de bloc', () => {
  const tris = [{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], color: [200, 0, 0] }];
  const blocks = voxelizeMesh(tris, { maxX: 4, maxY: 4, maxZ: 4, defaultBlock: 'stone', colors: () => 'bricks' });
  assert.ok(blocks.every((b) => b.block === 'bricks'));
});

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

function platformTriangles() {
  // plateforme horizontale en haut de la boîte + marqueur au sol pour étirer la bbox
  return [
    ...quad([0, 4, 0], [4, 4, 0], [4, 4, 4], [0, 4, 4]),
    { a: [0, 0, 0], b: [0.2, 0, 0], c: [0, 0, 0.2], color: null }
  ];
}

test('solid géologique : strates uniquement sous le socle de chaque colonne', () => {
  const underground = { fill: (x, y, z, depth) => (depth <= 2 ? 'dirt' : 'stone') };
  const blocks = voxelizeMesh(platformTriangles(), {
    maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'grass_block', solid: true, underground,
    surfaceThemeOf: () => 'vegetation'
  });
  const at = (x, y, z) => blocks.find((b) => b.x === x && b.y === y && b.z === z);
  assert.strictEqual(at(3, 7, 3).block, 'grass_block'); // plateforme = surface
  assert.strictEqual(at(3, 6, 3).block, 'dirt');        // depth 1
  assert.strictEqual(at(3, 5, 3).block, 'dirt');        // depth 2
  assert.strictEqual(at(3, 3, 3).block, 'stone');       // profond
  assert.ok(at(3, 0, 3));                               // socle jusqu'à y=0
});

test('solid géologique : petits vides internes comblés, grands volumes laissés ouverts', () => {
  // cube dans une boîte 12 → coquilles y=0 et y=11, vide interne 10 > 6 → reste ouvert
  const open = voxelizeMesh(cubeTriangles(), { maxX: 12, maxY: 12, maxZ: 12, defaultBlock: 'stone_bricks', solid: true });
  assert.ok(!open.some((b) => b.x === 5 && b.y === 5 && b.z === 5), 'grand vide comblé à tort');
  // cube dans une boîte 8 → vide interne 6 ≤ 6 → comblé avec le bloc de structure
  const closed = voxelizeMesh(cubeTriangles(), { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone_bricks', solid: true });
  const inner = closed.find((b) => b.x === 3 && b.y === 3 && b.z === 3);
  assert.ok(inner, 'petit vide non comblé');
  assert.strictEqual(inner.block, 'stone_bricks');      // continuité de structure, pas de strates
});

test('option up:x redresse un modèle couché sur x', () => {
  const tris = [{ a: [0, 0, 0], b: [6, 0, 0], c: [6, 1, 0], color: null }]; // longiligne en x
  const flat = voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone' });
  const up = voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', up: 'x' });
  const maxY = (bs) => Math.max(...bs.map((b) => b.y));
  assert.ok(maxY(flat) <= 2, 'sans up: doit rester couché');
  assert.ok(maxY(up) >= 5, 'up:x doit redresser en hauteur');
});

test('option up:z équivaut à zUp:true', () => {
  const tris = [{ a: [0, 0, 0], b: [0, 0, 6], c: [1, 0, 6], color: null }];
  const a = voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', zUp: true });
  const b = voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', up: 'z' });
  assert.deepStrictEqual(a.sort((p, q) => p.x - q.x || p.y - q.y || p.z - q.z), b.sort((p, q) => p.x - q.x || p.y - q.y || p.z - q.z));
});

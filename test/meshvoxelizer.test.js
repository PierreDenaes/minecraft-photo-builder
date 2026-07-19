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

test('cube → coquille pleine aux 6 faces, mis à l\'échelle', async () => {
  const blocks = await voxelizeMesh(cubeTriangles(), { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone' });
  const has = (x, y, z) => blocks.some((b) => b.x === x && b.y === y && b.z === z);
  assert.ok(has(0, 0, 0));
  assert.ok(has(7, 7, 7));
  assert.ok(has(0, 3, 3)); // milieu d'une face
  assert.ok(!has(3, 3, 3)); // intérieur creux
  assert.ok(blocks.every((b) => b.block === 'stone'));
  assert.ok(blocks.every((b) => b.x >= 0 && b.x <= 7 && b.y >= 0 && b.y <= 7 && b.z >= 0 && b.z <= 7));
});

test('couleur du triangle mappée vers un bloc', async () => {
  const colors = new Map([['red_concrete', [142, 32, 32]], ['stone', [125, 125, 125]]]);
  const tris = [{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], color: [255, 0, 0] }];
  const blocks = await voxelizeMesh(tris, { maxX: 4, maxY: 4, maxZ: 4, defaultBlock: 'stone', colors });
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((b) => b.block === 'red_concrete'));
});

test('zUp échange hauteur et profondeur', async () => {
  // triangle debout dans le plan x/z (z = vertical en convention z-up)
  const tris = [{ a: [0, 0, 0], b: [4, 0, 0], c: [0, 0, 4], color: null }];
  const flat = await voxelizeMesh(tris, { maxX: 5, maxY: 5, maxZ: 5, defaultBlock: 'stone', zUp: false });
  const up = await voxelizeMesh(tris, { maxX: 5, maxY: 5, maxZ: 5, defaultBlock: 'stone', zUp: true });
  assert.ok(flat.every((b) => b.y === 0));  // sans zUp : plat au sol
  assert.ok(up.some((b) => b.y > 0));       // avec zUp : vertical
});

test('accepte une fonction de choix de bloc', async () => {
  const tris = [{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], color: [200, 0, 0] }];
  const blocks = await voxelizeMesh(tris, { maxX: 4, maxY: 4, maxZ: 4, defaultBlock: 'stone', colors: () => 'bricks' });
  assert.ok(blocks.every((b) => b.block === 'bricks'));
});

function platformTriangles() {
  // plateforme horizontale en haut de la boîte + marqueur au sol pour étirer la bbox
  return [
    ...quad([0, 4, 0], [4, 4, 0], [4, 4, 4], [0, 4, 4]),
    { a: [0, 0, 0], b: [0.2, 0, 0], c: [0, 0, 0.2], color: null }
  ];
}

test('solid géologique : strates uniquement sous le socle de chaque colonne', async () => {
  const underground = { fill: (x, y, z, depth) => (depth <= 2 ? 'dirt' : 'stone') };
  const blocks = await voxelizeMesh(platformTriangles(), {
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

test('solid géologique : petits vides internes comblés, grands volumes laissés ouverts', async () => {
  // cube dans une boîte 12 → coquilles y=0 et y=11, vide interne 10 > 6 → reste ouvert
  const open = await voxelizeMesh(cubeTriangles(), { maxX: 12, maxY: 12, maxZ: 12, defaultBlock: 'stone_bricks', solid: true });
  assert.ok(!open.some((b) => b.x === 5 && b.y === 5 && b.z === 5), 'grand vide comblé à tort');
  // cube dans une boîte 8 → vide interne 6 ≤ 6 → comblé avec le bloc de structure
  const closed = await voxelizeMesh(cubeTriangles(), { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone_bricks', solid: true });
  const inner = closed.find((b) => b.x === 3 && b.y === 3 && b.z === 3);
  assert.ok(inner, 'petit vide non comblé');
  assert.strictEqual(inner.block, 'stone_bricks');      // continuité de structure, pas de strates
});

test('option up:x redresse un modèle couché sur x', async () => {
  const tris = [{ a: [0, 0, 0], b: [6, 0, 0], c: [6, 1, 0], color: null }]; // longiligne en x
  const flat = await voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone' });
  const up = await voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', up: 'x' });
  const maxY = (bs) => Math.max(...bs.map((b) => b.y));
  assert.ok(maxY(flat) <= 2, 'sans up: doit rester couché');
  assert.ok(maxY(up) >= 5, 'up:x doit redresser en hauteur');
});

test('option up:z équivaut à zUp:true', async () => {
  const tris = [{ a: [0, 0, 0], b: [0, 0, 6], c: [1, 0, 6], color: null }];
  const a = await voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', zUp: true });
  const b = await voxelizeMesh(tris, { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', up: 'z' });
  assert.deepStrictEqual(a.sort((p, q) => p.x - q.x || p.y - q.y || p.z - q.z), b.sort((p, q) => p.x - q.x || p.y - q.y || p.z - q.z));
});

test('les petits triangles (détails) gagnent sur les grands', async () => {
  const colors = new Map([['white_concrete', [207, 213, 214]], ['black_concrete', [8, 10, 15]]]);
  const big = { a: [0, 0, 0], b: [6, 0, 0], c: [0, 6, 0], color: [207, 213, 214] };   // face
  const detail = { a: [2, 2, 0], b: [2.6, 2, 0], c: [2, 2.6, 0], color: [8, 10, 15] }; // œil
  const blocks = await voxelizeMesh([detail, big], { maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone', colors });
  const eye = blocks.find((b) => b.block === 'black_concrete');
  assert.ok(eye, 'le détail sombre a été écrasé par la grande face');
});

test('voxelizeMesh cède la main à l\'event loop pendant un gros calcul (anti-kick keep-alive)', async () => {
  const tris = [];
  for (let i = 0; i < 300; i++) {
    const f = (n) => (((i * 37 + n * 61) % 97) / 97) * 96;
    tris.push({ a: [f(1), f(2), f(3)], b: [f(4), f(5), f(6)], c: [f(7), f(8), f(9)], color: null });
  }
  let ticks = 0;
  const iv = setInterval(() => { ticks++; }, 5);
  const blocks = await voxelizeMesh(tris, { maxX: 96, maxY: 96, maxZ: 96, defaultBlock: 'stone' });
  clearInterval(iv);
  assert.ok(blocks.length > 0);
  assert.ok(ticks >= 3, `event loop bloqué pendant la voxelisation : ${ticks} tick(s) de timer`);
});

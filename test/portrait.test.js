const { test } = require('node:test');
const assert = require('node:assert');
const { portraitBlocks } = require('../src/portrait');

const colors = new Map([
  ['red_concrete', [200, 30, 30]],
  ['blue_concrete', [40, 60, 180]],
  ['white_concrete', [230, 230, 230]]
]);

function image2x2() {
  // rangée haute : rouge, bleu — rangée basse : blanc, rouge
  return { data: Buffer.from([200, 30, 30, 40, 60, 180, 230, 230, 230, 200, 30, 30]), width: 2, height: 2 };
}

test('fresque : chaque pixel devient le bloc le plus proche, y inversé', () => {
  const blocks = portraitBlocks(image2x2(), { colors, frame: false });
  assert.strictEqual(blocks.length, 4);
  const at = (x, y) => blocks.find((b) => b.x === x && b.y === y && b.z === 0);
  assert.strictEqual(at(0, 1).block, 'red_concrete');   // pixel haut-gauche → y haut
  assert.strictEqual(at(1, 1).block, 'blue_concrete');
  assert.strictEqual(at(0, 0).block, 'white_concrete'); // pixel bas-gauche → y bas
  assert.strictEqual(at(1, 0).block, 'red_concrete');
});

test('cadre en dark_oak_planks autour de la fresque', () => {
  const blocks = portraitBlocks(image2x2(), { colors, frame: true });
  const frame = blocks.filter((b) => b.block === 'dark_oak_planks');
  assert.strictEqual(frame.length, (4 * 4) - (2 * 2)); // anneau 4×4 moins l'image 2×2
  assert.ok(frame.every((b) => b.z === 0));
  const image = blocks.filter((b) => b.block !== 'dark_oak_planks');
  assert.ok(image.every((b) => b.x >= 1 && b.x <= 2 && b.y >= 1 && b.y <= 2)); // image décalée dans le cadre
});

test('fresque déterministe', () => {
  const a = portraitBlocks(image2x2(), { colors, frame: true });
  const b = portraitBlocks(image2x2(), { colors, frame: true });
  assert.deepStrictEqual(a, b);
});

test('fresque : jamais de fluides — l\'eau coulerait hors du mur', () => {
  const fluides = new Map([
    ['water', [40, 60, 180]],
    ['lava', [220, 100, 20]],
    ['white_concrete', [230, 230, 230]]
  ]);
  // pixel bleu pile sur la couleur de l'eau, pixel orange pile sur la lave
  const img = { data: Buffer.from([40, 60, 180, 220, 100, 20]), width: 2, height: 1 };
  const blocks = portraitBlocks(img, { colors: fluides, frame: false });
  assert.ok(blocks.every((b) => b.block !== 'water' && b.block !== 'lava'),
    `fluide dans la fresque : ${blocks.map((b) => b.block).join(', ')}`);
});

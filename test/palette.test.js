const { test } = require('node:test');
const assert = require('node:assert');
const { clusterColors, assignBlocks, buildPaletteMap } = require('../src/palette');

const allowed = new Map([
  ['stone', [126, 126, 126]],
  ['grass_block', [84, 109, 51]],
  ['red_concrete', [142, 33, 33]],
  ['oak_planks', [162, 131, 79]]
]);

test('clusterColors regroupe deux familles nettes', () => {
  const samples = [];
  for (let i = 0; i < 50; i++) samples.push([120 + (i % 5), 120, 120]); // gris
  for (let i = 0; i < 50; i++) samples.push([140, 30 + (i % 5), 30]);   // rouge
  const centroids = clusterColors(samples, 2);
  assert.strictEqual(centroids.length, 2);
  const sorted = [...centroids].sort((a, b) => a[1] - b[1]); // par canal vert
  assert.ok(Math.abs(sorted[0][0] - 140) < 10 && sorted[0][1] < 60);   // famille rouge
  assert.ok(Math.abs(sorted[1][0] - 122) < 10 && sorted[1][1] > 100);  // famille grise
});

test('clusterColors est déterministe et borne k au nombre d\'échantillons', () => {
  const samples = [[10, 10, 10], [200, 200, 200]];
  const a = clusterColors(samples, 8);
  const b = clusterColors(samples, 8);
  assert.deepStrictEqual(a, b);
  assert.ok(a.length <= 2);
});

test('assignBlocks sans client : plus proche voisin par centroïde', async () => {
  const blocks = await assignBlocks([[125, 125, 125], [85, 110, 50]], allowed, {});
  assert.deepStrictEqual(blocks, ['stone', 'grass_block']);
});

test('assignBlocks avec client : choix du LLM respecté, bloc invalide → repli', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify([
    { rgb: [125, 125, 125], bloc: 'oak_planks' },
    { rgb: [85, 110, 50], bloc: 'bloc_inexistant' }
  ]) }] }) } };
  const blocks = await assignBlocks([[125, 125, 125], [85, 110, 50]], allowed, { client, contexte: 'test' });
  assert.strictEqual(blocks[0], 'oak_planks');      // choix délibéré du LLM accepté
  assert.strictEqual(blocks[1], 'grass_block');     // invalide → nearest
});

test('buildPaletteMap : les couleurs de la scène ne mappent que vers les blocs choisis', () => {
  const map = buildPaletteMap([[125, 125, 125], [85, 110, 50]], ['stone', 'grass_block']);
  assert.strictEqual(map.size, 2);
  assert.deepStrictEqual(map.get('stone'), [125, 125, 125]);
  const { nearestBlock } = require('../src/blockcolors');
  assert.strictEqual(nearestBlock(130, 128, 126, map), 'stone');
  assert.strictEqual(nearestBlock(90, 115, 60, map), 'grass_block');
});

test('buildPaletteMap déduplique les blocs choisis en gardant le premier centroïde', () => {
  const map = buildPaletteMap([[125, 125, 125], [130, 130, 130]], ['stone', 'stone']);
  assert.strictEqual(map.size, 1);
  assert.deepStrictEqual(map.get('stone'), [125, 125, 125]);
});

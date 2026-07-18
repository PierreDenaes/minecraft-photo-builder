const { test } = require('node:test');
const assert = require('node:assert');
const { loadBlockColors, nearestBlock } = require('../src/blockcolors');

const table = new Map([
  ['red_concrete', [142, 32, 32]],
  ['white_concrete', [207, 213, 214]],
  ['black_concrete', [8, 10, 15]],
  ['grass_block', [80, 120, 60]]
]);

test('rouge pur → bloc rouge', () => {
  assert.strictEqual(nearestBlock(255, 0, 0, table), 'red_concrete');
});

test('blanc → bloc blanc', () => {
  assert.strictEqual(nearestBlock(250, 250, 250, table), 'white_concrete');
});

test('noir → bloc noir', () => {
  assert.strictEqual(nearestBlock(5, 5, 5, table), 'black_concrete');
});

test('loadBlockColors charge la table réelle', () => {
  const colors = loadBlockColors();
  assert.ok(colors instanceof Map);
  assert.ok(colors.size > 50);
  assert.ok(Array.isArray(colors.get('stone')));
});

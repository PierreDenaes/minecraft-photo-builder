const { test } = require('node:test');
const assert = require('node:assert');
const { optimizeToCommands } = require('../src/optimizer');

const origin = { x: 100, y: -60, z: 200 };

test('fusionne un run contigu sur x en /fill', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 1, y: 0, z: 0, block: 'stone' },
    { x: 2, y: 0, z: 0, block: 'stone' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/fill 100 -60 200 102 -60 200 stone'
  ]);
});

test('bloc isolé en /setblock', () => {
  assert.deepStrictEqual(
    optimizeToCommands([{ x: 5, y: 2, z: 3, block: 'oak_planks' }], origin),
    ['/setblock 105 -58 203 oak_planks']
  );
});

test('coupe le run quand le bloc change', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 1, y: 0, z: 0, block: 'stone' },
    { x: 2, y: 0, z: 0, block: 'oak_planks' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/fill 100 -60 200 101 -60 200 stone',
    '/setblock 102 -60 200 oak_planks'
  ]);
});

test('trie par couches y croissant', () => {
  const blocks = [
    { x: 0, y: 5, z: 0, block: 'stone' },
    { x: 0, y: 0, z: 0, block: 'stone' }
  ];
  const cmds = optimizeToCommands(blocks, origin);
  assert.match(cmds[0], /-60/);
  assert.match(cmds[1], /-55/);
});

test('déduplique une coordonnée en gardant le dernier bloc', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 0, y: 0, z: 0, block: 'oak_planks' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/setblock 100 -60 200 oak_planks'
  ]);
});

test('ignore les blocs air', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'air' },
    { x: 1, y: 0, z: 0, block: 'stone' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/setblock 101 -60 200 stone'
  ]);
});

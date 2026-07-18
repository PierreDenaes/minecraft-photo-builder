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

const { filterColors, NATURAL_BLOCKS, CONSTRUCTION_BLOCKS, THEME_BLOCKS, INTERIOR_BLOCKS } = require('../src/blockcolors');

test('filterColors ne garde que l\'intersection', () => {
  const src = new Map([['stone', [1, 1, 1]], ['furnace', [2, 2, 2]], ['dirt', [3, 3, 3]]]);
  const out = filterColors(src, new Set(['stone', 'dirt', 'absent']));
  assert.deepStrictEqual([...out.keys()].sort(), ['dirt', 'stone']);
});

test('le gravier est exclu du thème roche mais reste dans terre', () => {
  assert.ok(!THEME_BLOCKS.roche.has('gravel'));
  assert.ok(THEME_BLOCKS.terre.has('gravel'));
});

test('les minerais sont dans la liste blanche', () => {
  const valid = new Set(require('../data/valid_blocks.json'));
  for (const ore of ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore',
    'diamond_ore', 'emerald_ore', 'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore',
    'deepslate_gold_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_diamond_ore',
    'deepslate_emerald_ore']) {
    assert.ok(valid.has(ore), ore);
  }
});

test('la palette nature exclut les blocs fonctionnels et manufacturés', () => {
  for (const b of ['furnace', 'bookshelf', 'crafting_table', 'chest', 'hay_block', 'white_concrete']) {
    assert.ok(!NATURAL_BLOCKS.has(b), `${b} ne doit pas être naturel`);
  }
  for (const b of ['dirt', 'grass_block', 'stone', 'gravel', 'oak_leaves', 'tuff']) {
    assert.ok(NATURAL_BLOCKS.has(b), `${b} doit être naturel`);
  }
});

test('la palette construction exclut les blocs fonctionnels', () => {
  for (const b of ['furnace', 'bookshelf', 'chest', 'pumpkin', 'campfire', 'lantern']) {
    assert.ok(!CONSTRUCTION_BLOCKS.has(b), `${b} ne doit pas être un matériau`);
  }
  for (const b of ['stone_bricks', 'oak_planks', 'white_concrete', 'glass_pane', 'dark_oak_log']) {
    assert.ok(CONSTRUCTION_BLOCKS.has(b), `${b} doit être un matériau`);
  }
});

test('la palette intérieure contient le mobilier et exclut le décor', () => {
  for (const b of ['bookshelf', 'lantern', 'chest', 'crafting_table', 'oak_door', 'red_wool']) {
    assert.ok(INTERIOR_BLOCKS.has(b), b);
  }
  for (const b of ['water', 'grass_block', 'oak_leaves', 'dirt']) {
    assert.ok(!INTERIOR_BLOCKS.has(b), `${b} n'est pas du mobilier`);
  }
  const valid = new Set(require('../data/valid_blocks.json'));
  for (const b of INTERIOR_BLOCKS) assert.ok(valid.has(b), `${b} hors liste blanche`);
});

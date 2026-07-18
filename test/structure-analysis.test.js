const { test } = require('node:test');
const assert = require('node:assert');
const { analyzeStructure } = require('../src/structure-analysis');

function slab(x1, x2, z1, z2, y, block = 'stone') {
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y, z, block });
  return out;
}

function pillar(x, z, h, block = 'stone_bricks') {
  const out = [];
  for (let y = 0; y < h; y++) out.push({ x, y, z, block });
  return out;
}

test('dims, heightmap et footprint sur une dalle', () => {
  const blocks = slab(0, 31, 0, 23, 0, 'grass_block');
  const a = analyzeStructure(blocks);
  assert.deepStrictEqual(a.dims, { x: 32, y: 1, z: 24 });
  assert.strictEqual(a.heightmap.length, 12);
  assert.strictEqual(a.heightmap[0].length, 16);
  assert.ok(a.heightmap.every((row) => row.every((h) => h === 1)));
  assert.ok(a.footprint.every((row) => row.every((f) => f === 1)));
});

test('deux piliers hauts → deux tours aux bonnes positions', () => {
  const blocks = [
    ...slab(0, 31, 0, 23, 0, 'stone'),
    ...pillar(4, 4, 20), ...pillar(5, 4, 20), ...pillar(4, 5, 20), ...pillar(5, 5, 20),
    ...pillar(27, 19, 20), ...pillar(28, 19, 20), ...pillar(27, 20, 20), ...pillar(28, 20, 20)
  ];
  const a = analyzeStructure(blocks);
  assert.strictEqual(a.towers.length, 2);
  const sorted = a.towers.sort((t1, t2) => t1.cx - t2.cx);
  assert.ok(Math.abs(sorted[0].cx - 4.5) < 3 && Math.abs(sorted[0].cz - 4.5) < 3);
  assert.ok(Math.abs(sorted[1].cx - 27.5) < 3 && Math.abs(sorted[1].cz - 19.5) < 3);
  assert.strictEqual(sorted[0].height, 20);
});

test('themes liste les matières dominantes', () => {
  const blocks = [...slab(0, 15, 0, 11, 0, 'grass_block'), ...pillar(8, 6, 10, 'stone_bricks')];
  const a = analyzeStructure(blocks);
  assert.ok(a.themes.includes('vegetation'));
  assert.ok(a.themes.includes('maconnerie'));
});

test('carte ASCII 0-9 alignée sur la heightmap', () => {
  const blocks = [...slab(0, 31, 0, 23, 0, 'stone'), ...pillar(4, 4, 20), ...pillar(5, 5, 20)];
  const a = analyzeStructure(blocks);
  assert.strictEqual(a.carte.length, 12);
  assert.strictEqual(a.carte[0].length, 16);
  assert.strictEqual(a.carte[2][2], '9');            // pilier plein
  assert.strictEqual(a.carte[11][15], '0');          // dalle h=1 → round(1/20*9)=0
});

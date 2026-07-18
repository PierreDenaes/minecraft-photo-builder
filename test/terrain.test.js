const { test } = require('node:test');
const assert = require('node:assert');
const { terrainFromHeightmap } = require('../src/terrain');

const flat = [[4, 4], [4, 4]]; // heightmap 2×2 uniforme

test('bords fondus à ~0, centre à pleine hauteur', () => {
  const blocks = terrainFromHeightmap(flat, { sizeX: 60, sizeZ: 60, maxHeight: 12, taperWidth: 12 });
  const heightAt = (x, z) => Math.max(-1, ...blocks.filter((b) => b.x === x && b.z === z).map((b) => b.y));
  assert.ok(heightAt(30, 30) >= 10, `centre trop bas : ${heightAt(30, 30)}`);
  assert.ok(heightAt(0, 30) <= 1, `bord ouest non fondu : ${heightAt(0, 30)}`);
  assert.ok(heightAt(30, 59) <= 1, `bord sud non fondu : ${heightAt(30, 59)}`);
});

test('surface en grass_block, strates dessous', () => {
  const blocks = terrainFromHeightmap(flat, { sizeX: 40, sizeZ: 40, maxHeight: 10, taperWidth: 8 });
  const col = blocks.filter((b) => b.x === 20 && b.z === 20).sort((a, b) => b.y - a.y);
  assert.strictEqual(col[0].block, 'grass_block');
  assert.strictEqual(col[1].block, 'dirt');
  assert.strictEqual(col[2].block, 'dirt');
  assert.strictEqual(col[3].block, 'stone');
  assert.strictEqual(col[col.length - 1].y, 0); // plein jusqu'au sol
});

test('underground appliqué avec le thème vegetation', () => {
  const calls = [];
  const underground = { fill: (x, y, z, depth, theme) => { calls.push(theme); return 'stone'; } };
  terrainFromHeightmap(flat, { sizeX: 20, sizeZ: 20, maxHeight: 6, taperWidth: 4, underground });
  assert.ok(calls.length > 0);
  assert.ok(calls.every((t) => t === 'vegetation'));
});

test('interpolation bilinéaire : pente douce entre cellules inégales', () => {
  const slope = [[0, 8], [0, 8]];
  const blocks = terrainFromHeightmap(slope, { sizeX: 80, sizeZ: 20, maxHeight: 8, taperWidth: 0 });
  const h = (x) => Math.max(0, ...blocks.filter((b) => b.x === x && b.z === 10).map((b) => b.y));
  assert.ok(h(20) < h(40) && h(40) < h(60), `pas de pente : ${h(20)} ${h(40)} ${h(60)}`);
});

const { test } = require('node:test');
const assert = require('node:assert');
const { validateStructure } = require('../src/optimizer');

const limits = { maxSize: 64, maxBlocks: 100000, validBlocks: ['stone', 'oak_planks', 'air'] };

test('accepte une structure valide', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 1, y: 0, z: 0, block: 'oak_planks' }
  ];
  assert.deepStrictEqual(validateStructure(blocks, limits), { ok: true, errors: [] });
});

test('rejette une structure vide', () => {
  const r = validateStructure([], limits);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /vide/);
});

test('rejette un bloc inconnu', () => {
  const r = validateStructure([{ x: 0, y: 0, z: 0, block: 'kryptonite' }], limits);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(' '), /kryptonite/);
});

test('rejette des coordonnées non entières ou négatives', () => {
  assert.strictEqual(validateStructure([{ x: 0.5, y: 0, z: 0, block: 'stone' }], limits).ok, false);
  assert.strictEqual(validateStructure([{ x: -1, y: 0, z: 0, block: 'stone' }], limits).ok, false);
});

test('rejette une structure trop grande', () => {
  const r = validateStructure([
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 64, y: 0, z: 0, block: 'stone' }
  ], limits);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(' '), /64/);
});

test('rejette trop de blocs', () => {
  const r = validateStructure(
    [{ x: 0, y: 0, z: 0, block: 'stone' }, { x: 1, y: 0, z: 0, block: 'stone' }],
    { ...limits, maxBlocks: 1 }
  );
  assert.strictEqual(r.ok, false);
});

test('rejette des éléments non-objets sans planter', () => {
  const r1 = validateStructure([null], limits);
  assert.strictEqual(r1.ok, false);
  assert.match(r1.errors.join(' '), /élément/);
  const r2 = validateStructure([42], limits);
  assert.strictEqual(r2.ok, false);
});

test('un état de bloc [facing=...] est accepté si le bloc de base est valide', () => {
  const ok = validateStructure([{ x: 0, y: 0, z: 0, block: 'wall_torch[facing=east]' }],
    { maxSize: 8, maxBlocks: 10, validBlocks: ['wall_torch'] });
  assert.strictEqual(ok.ok, true);
  const bad = validateStructure([{ x: 0, y: 0, z: 0, block: 'lave_magique[facing=east]' }],
    { maxSize: 8, maxBlocks: 10, validBlocks: ['wall_torch'] });
  assert.strictEqual(bad.ok, false);
});

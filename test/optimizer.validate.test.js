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

test('états de bloc malformés ou dangereux rejetés (surface d\'injection chat)', () => {
  const opts = { maxSize: 8, maxBlocks: 10, validBlocks: ['wall_torch'] };
  const bad = (name) => validateStructure([{ x: 0, y: 0, z: 0, block: name }], opts).ok;
  assert.strictEqual(bad('wall_torch[facing=east\n/op pirate]'), false);
  assert.strictEqual(bad('wall_torch[facing=east ]'), false);
  assert.strictEqual(bad('wall_torch['), false);
  assert.strictEqual(bad('wall_torch[facing=east]'), true);
});

test('états multiples nom[a=b,c=d] acceptés, crochet orphelin rejeté', () => {
  const opts = { maxSize: 8, maxBlocks: 10, validBlocks: ['oak_stairs'] };
  const ok = (name) => validateStructure([{ x: 0, y: 0, z: 0, block: name }], opts).ok;
  assert.strictEqual(ok('oak_stairs[facing=north,half=bottom]'), true);
  assert.strictEqual(ok('oak_stairs]'), false);
  assert.strictEqual(ok('oak_stairs[facing=north'), false);
});

test('maxSize objet {x,y,z} : accepte Y élancé (tour), refuse X excessif', () => {
  const validBlocks = ['stone'];
  const tour = [];
  for (let y = 0; y < 300; y++) tour.push({ x: 0, y, z: 0, block: 'stone' });
  tour.push({ x: 79, y: 0, z: 79, block: 'stone' });
  const okTour = validateStructure(tour, { maxSize: { x: 96, y: 320, z: 96 }, maxBlocks: 500000, validBlocks });
  assert.ok(okTour.ok, `tour élancée doit passer, erreurs : ${okTour.errors.join(', ')}`);

  const large = [];
  for (let x = 0; x < 100; x++) large.push({ x, y: 0, z: 0, block: 'stone' });
  const badLarge = validateStructure(large, { maxSize: { x: 96, y: 320, z: 96 }, maxBlocks: 500000, validBlocks });
  assert.ok(!badLarge.ok);
  assert.ok(badLarge.errors.some((e) => /dimension x trop grande/.test(e)));
});

test('maxSize scalaire : ancienne API rétrocompatible (limite unique x/y/z)', () => {
  const validBlocks = ['stone'];
  const bad = [];
  for (let y = 0; y < 100; y++) bad.push({ x: 0, y, z: 0, block: 'stone' });
  const r = validateStructure(bad, { maxSize: 96, maxBlocks: 500000, validBlocks });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => /dimension y trop grande/.test(e)));
});

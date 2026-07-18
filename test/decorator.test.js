const { test } = require('node:test');
const assert = require('node:assert');
const { detectFloors, decorateInterior } = require('../src/decorator');

function slabAt(y, w = 10, d = 8) {
  const out = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) out.push({ x, y, z, block: 'oak_planks' });
  return out;
}

function wallsTo(h, w = 10, d = 8) {
  const out = [];
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
    out.push({ x, y, z: 0, block: 'stone_bricks' });
    out.push({ x, y, z: d - 1, block: 'stone_bricks' });
  }
  return out;
}

const building = [...slabAt(0), ...slabAt(6), ...wallsTo(10)];

test('detectFloors repère les dalles, pas les murs', () => {
  assert.deepStrictEqual(detectFloors(building), [0, 6]);
});

test('decorateInterior filtre collisions, hors-boîte et blocs interdits', async () => {
  const code = `function generateStructure() {
    return [
      { x: 3, y: 1, z: 3, block: 'bookshelf' },
      { x: 3, y: 0, z: 3, block: 'lantern' },
      { x: 99, y: 1, z: 3, block: 'chest' },
      { x: 4, y: 1, z: 4, block: 'diamond_ore' }
    ];
  }`;
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: code }] }) } };
  const decor = await decorateInterior(building, { type_batiment: 'manoir' }, { client, timeoutMs: 5000 });
  assert.strictEqual(decor.length, 1);            // seul le bookshelf libre survit
  assert.deepStrictEqual(decor[0], { x: 3, y: 1, z: 3, block: 'bookshelf' });
});

test('échec API → aucun meuble, sans lever', async () => {
  const client = { messages: { create: async () => { throw new Error('panne'); } } };
  assert.deepStrictEqual(await decorateInterior(building, {}, { client, timeoutMs: 5000 }), []);
});

test('bâtiment sans plancher détecté → [] sans appel API', async () => {
  let called = false;
  const client = { messages: { create: async () => { called = true; return { content: [] }; } } };
  const decor = await decorateInterior(wallsTo(5), {}, { client, timeoutMs: 5000 });
  assert.deepStrictEqual(decor, []);
  assert.strictEqual(called, false);
});

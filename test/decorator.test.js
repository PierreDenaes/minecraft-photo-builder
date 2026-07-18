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

test('réponse tronquée → [] sans lever', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'function generateStructure() { return [' }] }) } };
  assert.deepStrictEqual(await decorateInterior(building, {}, { client, timeoutMs: 5000 }), []);
});

test('plafond de densité : le mobilier excédentaire est aminci déterministiquement', async () => {
  const items = [];
  for (let x = 1; x < 9; x++) for (let z = 1; z < 7; z++) items.push({ x, y: 1, z, block: 'bookshelf' });
  const code = `function generateStructure() { return ${JSON.stringify(items)}; }`;
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: code }] }) } };
  const a = await decorateInterior(building, {}, { client, timeoutMs: 5000 });
  const b = await decorateInterior(building, {}, { client, timeoutMs: 5000 });
  const cap = Math.ceil(10 * 8 * 2 * 0.10); // footprint 10×8 × 2 planchers × 10 %
  assert.ok(a.length <= cap, `trop de mobilier : ${a.length} > ${cap}`);
  assert.ok(a.length > 0);
  assert.deepStrictEqual(a, b); // amincissement déterministe
});

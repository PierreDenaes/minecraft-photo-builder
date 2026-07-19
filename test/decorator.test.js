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

test('physique du décor : sous toit et attaché uniquement', async () => {
  // pièce : dalle y0, plafond y4 (couvre x0-9,z0-7), mur x0 ; rampart x0-9,z10 SANS toit
  const room = [...slabAt(0), ...slabAt(4)];
  for (let y = 1; y < 4; y++) for (let z = 0; z < 8; z++) room.push({ x: 0, y, z, block: 'stone_bricks' });
  for (let x = 0; x < 10; x++) room.push({ x, y: 2, z: 10, block: 'stone_bricks' });
  const code = `function generateStructure() {
    return [
      { x: 3, y: 1, z: 3, block: 'bookshelf' },   // posé sur dalle, sous plafond → gardé
      { x: 1, y: 2, z: 3, block: 'torch' },       // flottant (rien dessous, pas contre mur x0? x1 adjacent x0 mur) → adjacent structure → gardé
      { x: 5, y: 2, z: 5, block: 'torch' },       // en l'air au milieu → supprimé
      { x: 5, y: 3, z: 10, block: 'lantern' }     // au-dessus du rampart sans toit → supprimé
    ];
  }`;
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: code }] }) } };
  const decor = await decorateInterior(room, {}, { client, timeoutMs: 5000 });
  const names = decor.map((b) => `${b.block}@${b.x},${b.y},${b.z}`).sort();
  // la torche contre le mur x0 devient une wall_torch orientée vers l'est (mur à l'ouest)
  assert.deepStrictEqual(names, ['bookshelf@3,1,3', 'wall_torch[facing=east]@1,2,3']);
});

const { fixAttachments } = require('../src/decorator');

test('torche : sur sol → debout, contre mur → wall_torch orientée, flottante → supprimée', () => {
  const solid = new Set(['5,0,5', '9,1,5']);
  const isSolid = (x, y, z) => solid.has(`${x},${y},${z}`);
  const items = [
    { x: 5, y: 1, z: 5, block: 'torch' },      // sol dessous → debout
    { x: 10, y: 1, z: 5, block: 'torch' },     // mur à x-1 → wall_torch facing=east
    { x: 20, y: 3, z: 20, block: 'torch' }     // rien → supprimée
  ];
  const out = fixAttachments(items, isSolid);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].block, 'torch');
  assert.strictEqual(out[1].block, 'wall_torch[facing=east]');
});

test('wall_torch du LLM : orientée selon le mur réel, sinon reposée debout ou supprimée', () => {
  const solid = new Set(['5,1,6', '8,0,2']);
  const isSolid = (x, y, z) => solid.has(`${x},${y},${z}`);
  const out = fixAttachments([
    { x: 5, y: 1, z: 5, block: 'wall_torch' }, // mur à z+1 → facing=north
    { x: 8, y: 1, z: 2, block: 'wall_torch' }, // pas de mur mais sol → torch debout
    { x: 30, y: 5, z: 30, block: 'wall_torch' } // rien → supprimée
  ], isSolid);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].block, 'wall_torch[facing=north]');
  assert.strictEqual(out[1].block, 'torch');
});

test('lanterne/campfire/pot : support plein dessous requis ; échelle : mur requis', () => {
  const solid = new Set(['1,0,1', '4,2,3']);
  const isSolid = (x, y, z) => solid.has(`${x},${y},${z}`);
  const out = fixAttachments([
    { x: 1, y: 1, z: 1, block: 'lantern' },   // posée
    { x: 2, y: 4, z: 2, block: 'lantern' },   // flottante → supprimée
    { x: 3, y: 2, z: 3, block: 'ladder' },    // mur à x+1 → facing=west
    { x: 9, y: 2, z: 9, block: 'ladder' }     // sans mur → supprimée
  ], isSolid);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].block, 'lantern');
  assert.strictEqual(out[1].block, 'ladder[facing=west]');
});

test('une torche ne sert pas de support à une autre torche', () => {
  const isSolid = () => false;
  const out = fixAttachments([
    { x: 5, y: 0, z: 5, block: 'torch' },
    { x: 5, y: 1, z: 5, block: 'torch' }
  ], isSolid);
  assert.strictEqual(out.length, 0);
});

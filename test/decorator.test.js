const { test } = require('node:test');
const assert = require('node:assert');
const { detectFloors, decorateInterior, fixAttachments, chooseFurnitureSets } = require('../src/decorator');

const sysText = (s) => (typeof s === 'string' ? s : s.map((b) => b.text).join('\n'));

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

// pièce fermée : dalle y0, plafond y5, 4 murs
function closedRoom(w = 12, d = 9, h = 6) {
  const out = [];
  const put = (x, y, z, block = 'stone_bricks') => out.push({ x, y, z, block });
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) { put(x, 0, z, 'oak_planks'); put(x, h - 1, z); }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 0; x < w; x++) { put(x, y, 0); put(x, y, d - 1); }
    for (let z = 0; z < d; z++) { put(0, y, z); put(w - 1, y, z); }
  }
  return out;
}

const building = [...slabAt(0), ...slabAt(6), ...wallsTo(10)];

test('detectFloors repère les dalles, pas les murs', () => {
  assert.deepStrictEqual(detectFloors(building), [0, 6]);
});

test('rôle LLM appliqué (Haiku) : layout chambre pose lit + barrel + éclairage plafond', async () => {
  let captured = null;
  const sets = '[{"piece":0,"role":"chambre"}]';
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: sets }] }; } } };
  const room = closedRoom();
  const decor = await decorateInterior(room, { type_batiment: 'manoir', style: 'medieval' }, { client });
  assert.strictEqual(captured.model, 'claude-haiku-4-5-20251001');
  assert.ok(sysText(captured.system).includes('JSON strict'));
  assert.ok(sysText(captured.system).includes('chambre'));
  assert.ok(captured.messages[0].content.includes('manoir'));
  assert.ok(decor.some((b) => /red_bed\[facing=.*part=foot\]/.test(b.block)), `pied de lit attendu : ${decor.map((b) => b.block).join(', ')}`);
  assert.ok(decor.some((b) => /red_bed\[facing=.*part=head\]/.test(b.block)), 'tête de lit attendue');
  assert.ok(decor.some((b) => /^lantern(\[|$)/.test(b.block)), 'lanterne au plafond attendue');
  const occ = new Set(room.map((b) => `${b.x},${b.y},${b.z}`));
  for (const b of decor) assert.ok(!occ.has(`${b.x},${b.y},${b.z}`), 'collision structure');
});

test('panne API → repli salon (pas de pièce vide)', async () => {
  const client = { messages: { create: async () => { throw new Error('panne'); } } };
  const decor = await decorateInterior(closedRoom(), {}, { client });
  assert.ok(decor.length > 0, `repli salon doit meubler : ${decor.length} blocs`);
  // le layout salon pose au moins des sièges (stairs) et éclairage plafond
  assert.ok(decor.some((b) => /oak_stairs/.test(b.block)) || decor.some((b) => b.block === 'lantern'),
    `salon devrait avoir stairs ou lantern : ${decor.map((b) => b.block).join(', ')}`);
});

test('sans client → repli sans appel API', async () => {
  const decor = await decorateInterior(closedRoom(), {}, {});
  assert.ok(decor.length > 0);
});

test('rôle inconnu → repli salon', async () => {
  const sets = '[{"piece":0,"role":"mine"}]';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: sets }] }) } };
  const decor = await decorateInterior(closedRoom(), {}, { client });
  assert.ok(!decor.some((b) => /diamond_ore|tnt/.test(b.block)));
  // repli salon : sièges (stairs) OU rangement (barrel avec facing)
  assert.ok(decor.some((b) => /oak_stairs|barrel/.test(b.block)));
});

test('bâtiment sans pièce → [] sans appel API', async () => {
  let called = false;
  const client = { messages: { create: async () => { called = true; return { content: [] }; } } };
  const decor = await decorateInterior(wallsTo(5), {}, { client });
  assert.deepStrictEqual(decor, []);
  assert.strictEqual(called, false);
});

test('décoration déterministe et plafonnée en densité', async () => {
  const sets = '[{"piece":0,"role":"grande salle","meubles":["bookshelf","barrel","chest","crafting_table","furnace","hay_block"]}]';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: sets }] }) } };
  const room = closedRoom(20, 16, 7);
  const a = await decorateInterior(room, {}, { client });
  const b = await decorateInterior(room, {}, { client });
  assert.deepStrictEqual(a, b);
  const cap = Math.ceil(20 * 16 * 2 * 0.10);
  assert.ok(a.length <= cap);
  assert.ok(a.length > 0);
});

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


test('lit dont la tête tomberait dans un mur → supprimé entièrement', () => {
  const solid = new Set(['2,0,5', '2,1,4']); // sol sous le pied + MUR à la place de la tête (facing=north → z-1)
  const isSolid = (x, y, z) => solid.has(`${x},${y},${z}`);
  const out = fixAttachments([{ x: 2, y: 1, z: 5, block: 'red_bed[facing=north,part=foot]' }], isSolid);
  assert.deepStrictEqual(out, []);
});


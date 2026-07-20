const { test } = require('node:test');
const assert = require('node:assert');
const { carveStaircase } = require('../src/staircase');
const { auditHabitability } = require('../src/habitability');

// bâtiment 2 niveaux SANS escalier : dalle y0, plancher y4, toit y8, murs pleins
function twoFloors(w = 14, d = 10) {
  const out = [];
  const put = (x, y, z, block) => out.push({ x, y, z, block });
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    put(x, 0, z, 'oak_planks'); put(x, 4, z, 'oak_planks'); put(x, 8, z, 'stone_bricks');
  }
  for (let y = 1; y < 8; y++) {
    for (let x = 0; x < w; x++) { put(x, y, 0, 'stone_bricks'); put(x, y, d - 1, 'stone_bricks'); }
    for (let z = 0; z < d; z++) { put(0, y, z, 'stone_bricks'); put(w - 1, y, z, 'stone_bricks'); }
  }
  // porte
  return out.filter((b) => !(b.z === 0 && b.x === 5 && (b.y === 1 || b.y === 2)));
}

test('carveStaircase : cage unique taillée, trémie percée, défaut d\'accès résolu', () => {
  const before = twoFloors();
  assert.ok(auditHabitability(before).some((dd) => /escalier/.test(dd)), 'le bâtiment de départ doit être en défaut');
  const { blocks, carved } = carveStaircase(before);
  assert.ok(carved > 0, 'au moins un escalier taillé');
  const stairs = blocks.filter((b) => /oak_stairs\[facing=/.test(b.block));
  assert.strictEqual(stairs.length, 4); // gap de 4 → 4 marches
  // marches ascendantes régulières (y croissants consécutifs)
  const ys = stairs.map((b) => b.y).sort((a, b) => a - b);
  assert.deepStrictEqual(ys, [1, 2, 3, 4]);
  // même facing pour toute la volée
  assert.strictEqual(new Set(stairs.map((b) => b.block)).size, 1);
  // l'audit d'accès passe désormais
  assert.ok(!auditHabitability(blocks).some((dd) => /escalier/.test(dd)));
  // la trémie existe : des cases du plancher y4 ont été retirées
  const slabAt4 = blocks.filter((b) => b.y === 4 && b.block === 'oak_planks').length;
  assert.ok(slabAt4 < 14 * 10, 'trémie attendue dans le plancher');
});

test('les escaliers intérieurs enchevêtrés du LLM sont remplacés par la cage propre', () => {
  const messy = twoFloors();
  messy.push({ x: 6, y: 2, z: 4, block: 'oak_stairs[facing=north]' });
  messy.push({ x: 7, y: 3, z: 3, block: 'spruce_stairs[facing=west]' });
  const { blocks } = carveStaircase(messy);
  assert.ok(!blocks.some((b) => b.block === 'oak_stairs[facing=north]' && b.x === 6));
  assert.ok(!blocks.some((b) => /spruce_stairs/.test(b.block)));
});

test('bâtiment sans étage → inchangé', () => {
  const plain = twoFloors().filter((b) => b.y <= 3);
  const { blocks, carved } = carveStaircase(plain);
  assert.strictEqual(carved, 0);
  assert.strictEqual(blocks.length, plain.length);
});

test('scène avec piscine : la cage est taillée DANS la maison', () => {
  const out = [];
  const put = (x, y, z, block = 'white_concrete') => out.push({ x, y, z, block });
  for (let x = 0; x < 14; x++) for (let z = 0; z < 10; z++) {
    put(x, 0, z, 'oak_planks'); put(x, 4, z, 'oak_planks'); put(x, 8, z, 'stone_bricks');
  }
  for (let y = 1; y < 8; y++) {
    for (let x = 0; x < 14; x++) { put(x, y, 0); put(x, y, 9); }
    for (let z = 0; z < 10; z++) { put(0, y, z); put(13, y, z); }
  }
  for (let x = 16; x < 45; x++) for (let z = 0; z < 25; z++) put(x, 0, z, 'smooth_stone');
  const { blocks, carved } = carveStaircase(out);
  assert.ok(carved > 0, 'cage attendue malgré la piscine');
  const stairs = blocks.filter((b) => /oak_stairs\[facing=/.test(b.block));
  assert.ok(stairs.every((b) => b.x < 14), 'marches dans la maison uniquement');
});

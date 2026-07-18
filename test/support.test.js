const { test } = require('node:test');
const assert = require('node:assert');
const { enforceSupport } = require('../src/support');

function box(x1, x2, y1, y2, z1, z2, block = 'stone') {
  const out = [];
  for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) out.push({ x, y, z, block });
  return out;
}

test('supprime un amas flottant, garde le pilier', () => {
  const pillar = box(0, 0, 0, 5, 0, 0);
  const floating = box(10, 11, 10, 11, 10, 11);
  const { blocks, removed } = enforceSupport([...pillar, ...floating]);
  assert.strictEqual(removed, 8);
  assert.strictEqual(blocks.length, 6);
  assert.ok(blocks.every((b) => b.x === 0));
});

test('une arche connectée est entièrement conservée', () => {
  const arch = [...box(0, 0, 0, 4, 0, 0), ...box(4, 4, 0, 4, 0, 0), ...box(1, 3, 4, 4, 0, 0)];
  const { blocks, removed } = enforceSupport(arch);
  assert.strictEqual(removed, 0);
  assert.strictEqual(blocks.length, arch.length);
});

test('structure vide : retour vide sans erreur', () => {
  assert.deepStrictEqual(enforceSupport([]), { blocks: [], removed: 0 });
});

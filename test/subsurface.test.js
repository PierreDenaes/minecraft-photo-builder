const { test } = require('node:test');
const assert = require('node:assert');
const { hash01, createUnderground } = require('../src/subsurface');

const ORES = new Set(['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore',
  'diamond_ore', 'emerald_ore']);
const DEEP_ORES = new Set([...ORES].map((o) => `deepslate_${o}`));

test('hash01 est déterministe et dans [0,1)', () => {
  assert.strictEqual(hash01(42, 1, 2, 3), hash01(42, 1, 2, 3));
  assert.notStrictEqual(hash01(42, 1, 2, 3), hash01(43, 1, 2, 3));
  for (let i = 0; i < 200; i++) {
    const v = hash01(7, i, i * 3, i * 7);
    assert.ok(v >= 0 && v < 1);
  }
});

test('strates : dirt sous surface végétale, roche ensuite, deepslate au fond', () => {
  const u = createUnderground({ seed: 1, maxY: 120 });
  assert.strictEqual(u.fill(50, 100, 50, 1, 'vegetation'), 'dirt');
  assert.strictEqual(u.fill(50, 99, 50, 2, 'vegetation'), 'dirt');
  assert.strictEqual(u.fill(50, 60, 50, 1, 'roche'), 'stone');
  const deep = u.fill(50, 10, 50, 3, 'roche'); // y=10 < 30 (25 % de 120) → zone deepslate
  assert.ok(deep === 'deepslate' || DEEP_ORES.has(deep) || deep === null);
});

test('déterminisme : même graine, même sous-sol', () => {
  const a = createUnderground({ seed: 9, maxY: 120 });
  const b = createUnderground({ seed: 9, maxY: 120 });
  for (let i = 0; i < 500; i++) {
    assert.strictEqual(a.fill(i % 40, 20 + (i % 50), i % 30, 5 + (i % 30), 'roche'),
      b.fill(i % 40, 20 + (i % 50), i % 30, 5 + (i % 30), 'roche'));
  }
});

test('cavités : jamais près de la surface ni du sol, fraction raisonnable en profondeur', () => {
  const u = createUnderground({ seed: 3, maxY: 120 });
  let caves = 0;
  let total = 0;
  for (let x = 0; x < 40; x++) for (let y = 35; y < 60; y++) for (let z = 0; z < 40; z++) {
    const b = u.fill(x, y, z, 20, 'roche');
    total++;
    if (b === null) caves++;
    assert.notStrictEqual(u.fill(x, y, z, 2, 'roche'), null, 'pas de cavité à depth 2');
    if (y < 2) assert.notStrictEqual(u.fill(x, 1, z, 20, 'roche'), null, 'pas de cavité sous y=2');
  }
  const frac = caves / total;
  assert.ok(frac > 0.04 && frac < 0.18, `fraction cavités ${frac}`);
});

test('minerais : présents, < 5 %, uniquement blocs autorisés, deepslate au fond', () => {
  const u = createUnderground({ seed: 5, maxY: 120 });
  let ores = 0;
  let total = 0;
  for (let x = 0; x < 40; x++) for (let y = 40; y < 70; y++) for (let z = 0; z < 40; z++) {
    const b = u.fill(x, y, z, 25, 'roche');
    total++;
    if (b === null) continue;
    if (b !== 'stone' && b !== 'deepslate' && b !== 'dirt') {
      ores++;
      assert.ok(ORES.has(b) || DEEP_ORES.has(b), `bloc inattendu ${b}`);
    }
  }
  assert.ok(ores > 0, 'aucun minerai généré');
  assert.ok(ores / total < 0.05, `trop de minerais : ${ores / total}`);
  // zone deepslate : les minerais y sont en variante deepslate
  for (let i = 0; i < 2000; i++) {
    const b = u.fill(i % 40, i % 25, (i * 7) % 40, 30, 'roche');
    if (b && b !== 'deepslate' && b !== null) assert.ok(DEEP_ORES.has(b) || b === 'deepslate', b);
  }
});

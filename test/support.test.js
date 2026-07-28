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

test('garde-fou : un voxel bas isolé ne détruit pas le bâtiment', () => {
  const mass = box(0, 4, 10, 14, 0, 4);          // 125 blocs en hauteur
  const outlier = [{ x: 20, y: 0, z: 20, block: 'stone' }];
  const { blocks, removed, guard } = enforceSupport([...outlier, ...mass]);
  assert.strictEqual(removed, 0);
  assert.strictEqual(guard, true);               // pathologie signalée à l'appelant
  assert.strictEqual(blocks.length, 126);        // tout conservé (couche de base anormale)
});

test('supporte 200k blocs sans explosion de pile', () => {
  const big = [];
  for (let i = 0; i < 200000; i++) big.push({ x: i % 100, y: Math.floor(i / 10000), z: Math.floor(i / 100) % 100, block: 'stone' });
  assert.doesNotThrow(() => enforceSupport(big));
});

const { rotateY } = require('../src/support');

test('rotateY : pivot 90° autour de la verticale', () => {
  const blocks = [{ x: 0, y: 2, z: 0, block: 'stone' }, { x: 4, y: 0, z: 1, block: 'dirt' }];
  const turned = rotateY(blocks);
  // (x,z) → (z, maxX−x) avec maxX=4 : (0,0)→(0,4) ; (4,1)→(1,0)
  assert.deepStrictEqual(turned.find((b) => b.block === 'stone'), { x: 0, y: 2, z: 4, block: 'stone' });
  assert.deepStrictEqual(turned.find((b) => b.block === 'dirt'), { x: 1, y: 0, z: 0, block: 'dirt' });
});

const { rotateX } = require('../src/support');

test('rotateX : redressement 90° autour de l\'axe horizontal', () => {
  // un bloc « haut » (y max) part vers l'avant : (y,z) → (z, maxY − y)
  const blocks = [{ x: 1, y: 0, z: 0, block: 'stone' }, { x: 1, y: 4, z: 2, block: 'dirt' }];
  const turned = rotateX(blocks);
  assert.deepStrictEqual(turned.find((b) => b.block === 'stone'), { x: 1, y: 0, z: 4, block: 'stone' });
  assert.deepStrictEqual(turned.find((b) => b.block === 'dirt'), { x: 1, y: 2, z: 0, block: 'dirt' });
});

// === Corrections audit 27/07 (CORRECTIONS-chat.md point 1) ===

test('rotateY réoriente les états de blocs (facing, faces booléennes, axis)', () => {
  const r = rotateY([
    { x: 0, y: 0, z: 0, block: 'oak_stairs[facing=east,half=bottom]' },
    { x: 1, y: 0, z: 0, block: 'vine[south=true]' },
    { x: 2, y: 0, z: 0, block: 'oak_log[axis=x]' },
    { x: 3, y: 0, z: 0, block: 'stone' }
  ]);
  assert.strictEqual(r[0].block, 'oak_stairs[facing=north,half=bottom]');
  assert.strictEqual(r[1].block, 'vine[east=true]');
  assert.strictEqual(r[2].block, 'oak_log[axis=z]');
  assert.strictEqual(r[3].block, 'stone');
});

test('rotateY : facing=north n\'est pas retouché par le replace des faces booléennes', () => {
  const r = rotateY([{ x: 0, y: 0, z: 0, block: 'oak_door[facing=north,half=lower,hinge=left]' }]);
  assert.strictEqual(r[0].block, 'oak_door[facing=west,half=lower,hinge=left]');
});

test('rotateY ×4 = identité (coordonnées ET états)', () => {
  const initial = [
    { x: 0, y: 0, z: 2, block: 'oak_stairs[facing=east,half=bottom]' },
    { x: 3, y: 1, z: 0, block: 'vine[south=true]' },
    { x: 1, y: 0, z: 1, block: 'oak_log[axis=x]' }
  ];
  let cur = initial;
  for (let i = 0; i < 4; i++) cur = rotateY(cur);
  const key = (a) => a.map((b) => `${b.x},${b.y},${b.z},${b.block}`).sort();
  assert.deepStrictEqual(key(cur), key(initial));
});

// === Corrections audit 27/07 (CORRECTIONS-petits-modules.md) ===
test('enforceSupport : l\'air explicite n\'est ni porteur ni élagable', () => {
  // un bloc air isolé en l'air doit survivre ; il ne doit pas "soutenir" de solide
  const { blocks, removed } = enforceSupport([
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 5, y: 5, z: 5, block: 'air' }
  ]);
  assert.strictEqual(removed, 0);
  assert.ok(blocks.some((b) => b.x === 5 && b.y === 5 && b.z === 5 && b.block === 'air'), 'air conservé');
  assert.ok(blocks.some((b) => b.x === 0 && b.block === 'stone'), 'stone de base conservé');
});

test('enforceSupport : un solide flottant relié seulement par de l\'air est élagué', () => {
  // colonne au sol + solide flottant séparé, "relié" uniquement via une case air :
  // l'air ne transmet pas le support → le solide flottant tombe
  const { blocks } = enforceSupport([
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 0, y: 1, z: 0, block: 'air' },
    { x: 0, y: 2, z: 0, block: 'stone' } // flottant, séparé du sol par de l'air
  ]);
  assert.ok(blocks.some((b) => b.x === 0 && b.y === 0 && b.block === 'stone'), 'base gardée');
  assert.ok(blocks.some((b) => b.y === 1 && b.block === 'air'), 'air toujours conservé');
  assert.ok(!blocks.some((b) => b.y === 2 && b.block === 'stone'), 'solide flottant élagué (air non porteur)');
});

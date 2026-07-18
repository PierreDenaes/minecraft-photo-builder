# Environnement complet — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scènes pleines et stratifiées (terre/roche/deepslate) avec cavités et minerais procéduraux, résolution 160×120×120, gravier hors du bâti.

**Architecture:** Un module `subsurface.js` (hachage déterministe → strates, cavités, minerais) partagé par les deux voxeliseurs ; remplissage plein par colonne dans le voxeliseur de mesh ; limites et throttle relevés.

**Tech Stack:** Node.js (existant), node:test.

## Global Constraints

- `limits.diorama = { size_x: 160, size_z: 120, max_y: 120, max_blocks: 1200000 }` ; `limits.max_blocks = 300000` ; `limits.throttle_cmds_per_tick = 16`
- `gravel` ∉ thème `roche` (reste dans `terre`)
- Strates : depth 1-2 = `dirt` si thème surface ∈ {vegetation, terre} sinon roche ; depth ≥ 3 = `stone` ; y < 25 % de maxY = `deepslate`
- Cavités : jamais si depth < 4 ou y < 2 ; fraction cible 8-12 % du volume profond
- Minerais (probabilité par bloc, zone stone / deepslate → variante `deepslate_*_ore`) : coal 1,2 % (depth 3-20), copper 0,8 % (3-20), iron 0,8 % (8-40), gold 0,35 % (depth > 25), redstone 0,3 % (> 30), lapis 0,2 % (> 25), diamond 0,12 % (> 45), emerald 0,06 % (> 45)
- Déterminisme : `hash01(seed, x, y, z)` — même graine ⇒ même monde
- Tests node:test, TDD ; messages joueur en français

---

### Task 1 : Config, throttle, gravier, liste blanche des minerais

**Files:**
- Modify: `config.json`, `src/blockcolors.js` (thème roche), `data/valid_blocks.json`
- Test: `test/blockcolors.test.js` (ajout), `test/palette.test.js` (le test buildThemePicker existant reste vert)

**Interfaces:**
- Produces: nouvelles limites lues par index.js ; `THEME_BLOCKS.roche` sans gravel ; 16 minerais dans la liste blanche

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/blockcolors.test.js` :

```javascript
test('le gravier est exclu du thème roche mais reste dans terre', () => {
  assert.ok(!THEME_BLOCKS.roche.has('gravel'));
  assert.ok(THEME_BLOCKS.terre.has('gravel'));
});

test('les minerais sont dans la liste blanche', () => {
  const valid = new Set(require('../data/valid_blocks.json'));
  for (const ore of ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore',
    'diamond_ore', 'emerald_ore', 'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore',
    'deepslate_gold_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_diamond_ore',
    'deepslate_emerald_ore']) {
    assert.ok(valid.has(ore), ore);
  }
});
```
(Le require de THEME_BLOCKS existe déjà dans ce fichier de test.)

- [ ] **Step 2 : RED** — `npm test` → 2 échecs.

- [ ] **Step 3 : Implémenter** — dans `src/blockcolors.js` retirer `'gravel'` du Set `roche` (le laisser dans `terre`). Dans `config.json` : `"max_blocks": 300000`, `"throttle_cmds_per_tick": 16`, `"diorama": { "size_x": 160, "size_z": 120, "max_y": 120, "max_blocks": 1200000 }`. Ajouter les 16 minerais à `data/valid_blocks.json` via :

```bash
node -e "const f='./data/valid_blocks.json';const l=require(f);const o=['coal_ore','iron_ore','copper_ore','gold_ore','redstone_ore','lapis_ore','diamond_ore','emerald_ore'];const m=[...new Set([...l,...o,...o.map(x=>'deepslate_'+x)])];require('fs').writeFileSync(f,JSON.stringify(m))"
```

- [ ] **Step 4 : GREEN** — `npm test` → tous verts (101 + 2 = 103).

- [ ] **Step 5 : Commit**

```bash
git add config.json src/blockcolors.js data/valid_blocks.json test/blockcolors.test.js
git commit -m "feat: limites 160x120, throttle 16, gravier hors bâti, minerais autorisés"
```

---

### Task 2 : Module subsurface (strates, cavités, minerais)

**Files:**
- Create: `src/subsurface.js`
- Test: `test/subsurface.test.js`

**Interfaces:**
- Produces: `hash01(seed, x, y, z) → [0,1)` déterministe ; `createUnderground({ seed, maxY }) → { fill(x, y, z, depth, surfaceTheme) → string | null }`

- [ ] **Step 1 : Test qui échoue** — `test/subsurface.test.js` :

```javascript
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
```

- [ ] **Step 2 : RED** — `npm test` → module introuvable.

- [ ] **Step 3 : Implémenter src/subsurface.js**

```javascript
// Sous-sol procédural déterministe : strates, cavités, minerais
function hash01(seed, x, y, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// [minerai, probabilité, profondeur min, y max (option)]
const ORE_TABLE = [
  ['coal_ore', 0.012, 3, null],
  ['copper_ore', 0.008, 3, null],
  ['iron_ore', 0.008, 8, null],
  ['gold_ore', 0.0035, 25, null],
  ['redstone_ore', 0.003, 30, null],
  ['lapis_ore', 0.002, 25, null],
  ['diamond_ore', 0.0012, 45, null],
  ['emerald_ore', 0.0006, 45, null]
];

function createUnderground({ seed, maxY }) {
  const deepslateY = Math.floor(maxY * 0.25);

  function isCave(x, y, z, depth) {
    if (depth < 4 || y < 2) return false;
    // poches : cellules 5x4x5 « caveuses » ~18 %, creusées à ~60 % en leur sein
    const cell = hash01(seed ^ 0xcave, Math.floor(x / 5), Math.floor(y / 4), Math.floor(z / 5));
    if (cell > 0.18) return false;
    return hash01(seed ^ 0xf055e, x, y, z) < 0.6;
  }

  function oreAt(x, y, z, depth) {
    const roll = hash01(seed ^ 0x0f0e, x, y, z);
    let acc = 0;
    for (const [ore, p, minDepth] of ORE_TABLE) {
      if (depth < minDepth) continue;
      acc += p;
      if (roll < acc) return ore;
    }
    return null;
  }

  function fill(x, y, z, depth, surfaceTheme) {
    if (depth <= 2 && (surfaceTheme === 'vegetation' || surfaceTheme === 'terre')) return 'dirt';
    if (depth <= 2) return y < deepslateY ? 'deepslate' : 'stone';
    if (isCave(x, y, z, depth)) return null;
    const deep = y < deepslateY;
    const ore = oreAt(x, y, z, depth);
    if (ore) return deep ? `deepslate_${ore}` : ore;
    return deep ? 'deepslate' : 'stone';
  }

  return { fill };
}

module.exports = { hash01, createUnderground };
```

Note : `0xcave`/`0xf055e`/`0x0f0e` ne sont pas des littéraux hexadécimaux valides — utiliser `0xCA4E`, `0xF055`, `0x0FE0`.

- [ ] **Step 4 : GREEN** — `npm test` → tous verts. Ajuster UNIQUEMENT les constantes de fraction (0.18/0.6) si le test de fraction sort de la fenêtre, jamais le test.

- [ ] **Step 5 : Commit**

```bash
git add src/subsurface.js test/subsurface.test.js
git commit -m "feat: sous-sol procédural — strates, cavités, minerais déterministes"
```

---

### Task 3 : Voxeliseur de scène stratifié

**Files:**
- Modify: `src/voxelizer.js`
- Test: `test/voxelizer.test.js`

**Interfaces:**
- Produces: `voxelizeScene(image, depthMap, { sizeX, sizeZ, maxY, colors, underground?, surfaceThemeOf? })` — le comblement sous le voxel le plus bas de chaque colonne passe par `underground.fill(x, y, z, depth, theme)` (depth = distance sous la surface, les `null` sont omis = cavités) ; sans `underground`, comportement actuel conservé (tests existants inchangés). `surfaceThemeOf(block) → theme` optionnel (défaut : null).

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/voxelizer.test.js` :

```javascript
test('comblement stratifié via underground', () => {
  const underground = {
    fill: (x, y, z, depth, theme) => (depth <= 2 ? 'dirt' : depth === 5 ? null : 'stone')
  };
  // moitié haute de l'image loin (z=3), moitié basse proche (z=6) → la colonne z=3
  // n'a de coquille qu'en hauteur (vy 6..11), comblement en dessous
  const depth = { width: 2, height: 2, data: new Float32Array([0.5, 0.5, 0.1, 0.1]) };
  const blocks = voxelizeScene(grayImage(2, 2), depth, {
    sizeX: 1, sizeZ: 8, maxY: 12, colors, underground, surfaceThemeOf: () => 'roche'
  });
  const z = 7 - Math.round(0.5 * 7); // = 3 ; coquille de cette colonne : vy 6..11 → minY = 6
  const at = (y) => blocks.find((b) => b.z === z && b.y === y);
  assert.strictEqual(at(5).block, 'dirt');   // depth 1
  assert.strictEqual(at(4).block, 'dirt');   // depth 2
  assert.strictEqual(at(3).block, 'stone');  // depth 3
  assert.strictEqual(at(1), undefined);      // depth 5 → cavité omise
  assert.strictEqual(at(6).block, 'stone');  // la coquille garde son bloc (gris → stone)
});
```

- [ ] **Step 2 : RED** — l'option est ignorée (tout est rempli avec le bloc du bas).

- [ ] **Step 3 : Implémenter** — dans `voxelizeScene`, signature `{ sizeX, sizeZ, maxY, colors, underground, surfaceThemeOf }`. Dans la boucle de comblement, remplacer :

```javascript
    const minY = Math.min(...col.keys());
    const bottom = col.get(minY);
    for (let y = 0; y < minY; y++) blocks.push({ x, y, z, block: bottom });
```

par :

```javascript
    const minY = Math.min(...col.keys());
    const bottom = col.get(minY);
    const theme = surfaceThemeOf ? surfaceThemeOf(bottom) : null;
    for (let y = 0; y < minY; y++) {
      if (!underground) { blocks.push({ x, y, z, block: bottom }); continue; }
      const filled = underground.fill(x, y, z, minY - y, theme);
      if (filled !== null) blocks.push({ x, y, z, block: filled });
    }
```

- [ ] **Step 4 : GREEN** — `npm test` (les 5 tests voxelizer existants restent verts : sans `underground`, chemin inchangé).

- [ ] **Step 5 : Commit**

```bash
git add src/voxelizer.js test/voxelizer.test.js
git commit -m "feat: comblement stratifié du diorama via le sous-sol procédural"
```

---

### Task 4 : Voxeliseur de mesh plein + sous-sol

**Files:**
- Modify: `src/meshvoxelizer.js`
- Test: `test/meshvoxelizer.test.js`

**Interfaces:**
- Produces: `voxelizeMesh(triangles, { maxX, maxY, maxZ, defaultBlock, colors, zUp, solid?, underground?, surfaceThemeOf? })` — si `solid`, chaque colonne (x,z) est remplie de y=0 au voxel de surface le plus haut : vides internes entre coquilles comblés par `underground.fill` (depth = distance sous le voxel de coquille supérieur le plus proche) ou par `defaultBlock` sans underground ; cavités (null) omises. Sans `solid`, comportement actuel.

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/meshvoxelizer.test.js` :

```javascript
test('solid : colonnes pleines du sol à la surface, sous-sol appliqué', () => {
  const underground = { fill: (x, y, z, depth) => (depth <= 2 ? 'dirt' : 'stone') };
  const blocks = voxelizeMesh(cubeTriangles(), {
    maxX: 8, maxY: 8, maxZ: 8, defaultBlock: 'stone_bricks', solid: true, underground,
    surfaceThemeOf: () => 'roche'
  });
  const has = (x, y, z) => blocks.find((b) => b.x === x && b.y === y && b.z === z);
  assert.ok(has(3, 3, 3), 'intérieur rempli');            // creux avant, plein maintenant
  assert.strictEqual(has(3, 5, 3).block, 'dirt');         // 2 sous la coquille haute (y=7)
  assert.strictEqual(has(3, 3, 3).block, 'stone');        // plus profond
  assert.strictEqual(has(0, 3, 3).block, 'stone_bricks'); // la coquille garde son bloc
});

test('solid sans underground : rempli avec defaultBlock', () => {
  const blocks = voxelizeMesh(cubeTriangles(), { maxX: 6, maxY: 6, maxZ: 6, defaultBlock: 'stone', solid: true });
  assert.ok(blocks.some((b) => b.x === 3 && b.y === 3 && b.z === 3));
});
```

- [ ] **Step 2 : RED** — intérieur absent (coquille creuse).

- [ ] **Step 3 : Implémenter** — après la rasterisation (avant le `return`), quand `solid` :

```javascript
  if (solid) {
    const columns = new Map(); // "x,z" → { top: y max de coquille, shellYs: Set }
    for (const [k] of marked) {
      const [x, y, z] = k.split(',').map(Number);
      const ck = `${x},${z}`;
      if (!columns.has(ck)) columns.set(ck, { top: y, shellYs: new Set([y]) });
      else {
        const c = columns.get(ck);
        c.top = Math.max(c.top, y);
        c.shellYs.add(y);
      }
    }
    for (const [ck, { top, shellYs }] of columns) {
      const [x, z] = ck.split(',').map(Number);
      for (let y = 0; y < top; y++) {
        if (shellYs.has(y) || marked.has(`${x},${y},${z}`)) continue;
        // profondeur = distance au voxel de coquille supérieur le plus proche
        let depth = 1;
        for (let yy = y + 1; yy <= top; yy++) {
          if (shellYs.has(yy)) break;
          depth++;
        }
        if (underground) {
          const theme = surfaceThemeOf ? surfaceThemeOf(marked.get(`${x},${top},${z}`)) : null;
          const filled = underground.fill(x, y, z, depth, theme);
          if (filled !== null) marked.set(`${x},${y},${z}`, filled);
        } else {
          marked.set(`${x},${y},${z}`, defaultBlock);
        }
      }
    }
  }
```

(La signature devient `{ maxX, maxY, maxZ, defaultBlock, colors, zUp = false, solid = false, underground, surfaceThemeOf }`.)

- [ ] **Step 4 : GREEN** — `npm test` (les tests existants restent verts : `solid` défaut false).
Vérifier le test « cube → coquille » existant : il assert `!has(3,3,3)` SANS solid — inchangé ✓.

- [ ] **Step 5 : Commit**

```bash
git add src/meshvoxelizer.js test/meshvoxelizer.test.js
git commit -m "feat: voxelisation pleine par colonne avec sous-sol procédural"
```

---

### Task 5 : Câblage index + graine + thème de surface

**Files:**
- Modify: `src/index.js`
- Test: vérification manuelle (app + upload cube.obj)

**Interfaces:**
- Consumes: `createUnderground`, `themeOfBlock` (déjà exporté par palette.js)

- [ ] **Step 1 : Implémenter** — imports :

```javascript
const { createUnderground } = require('./subsurface');
const { themeOfBlock } = require('./palette');
```

Dans `onDiorama`, avant `voxelizeScene` :

```javascript
    const seed = Math.floor(Math.random() * 2 ** 31);
    console.log(`[diorama] graine sous-sol : ${seed}`);
    const underground = createUnderground({ seed, maxY: dio.max_y });
```

et l'appel devient :

```javascript
    let blocks = voxelizeScene(image, depthMap, {
      sizeX: dio.size_x, sizeZ: dio.size_z, maxY: dio.max_y, colors: paletteScene,
      underground, surfaceThemeOf: themeOfBlock
    });
```

Dans `onModel`, même graine/underground (`maxY: dio.max_y`) et :

```javascript
    const blocks = voxelizeMesh(triangles, {
      maxX: dio.size_x, maxY: dio.max_y, maxZ: dio.size_z,
      defaultBlock: 'stone', colors, zUp: ext === 'stl',
      solid: true, underground, surfaceThemeOf: themeOfBlock
    });
```

- [ ] **Step 2 : Vérifier** — `npm test` tous verts ; démarrer l'app en arrière-plan (clé API fournie par le contrôleur), uploader `test/fixtures/cube.obj` en mode diorama via curl (username `Pierre_Test`), vérifier dans les logs la proposition et que le total de blocs a fortement augmenté vs 18 004 (cube plein + sous-sol), puis tuer l'app.

- [ ] **Step 3 : Commit**

```bash
git add src/index.js
git commit -m "feat: câblage sous-sol procédural et remplissage plein dans les pipelines"
```

---

### Task 6 : Sanity e2e et merge

- [ ] **Step 1** — `npm test` complet ; relancer `node scripts/e2e-diorama.js` avec l'app démarrée (les timeouts existants suffisent : le cube plein reste petit) ; bilan attendu tout PASS.
- [ ] **Step 2** — merge dans `main` après revue finale.

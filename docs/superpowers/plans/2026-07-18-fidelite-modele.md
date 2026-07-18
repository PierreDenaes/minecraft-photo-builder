# Fidélité au modèle — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'IA voit le modèle et son environnement (rendu ¾ → vision), lit une carte ASCII, respecte la gravité (prompt + enforceSupport), et replante une végétation cohérente.

**Architecture:** `render.js` (projection iso peintre → PNG sharp) alimente la vision étendue (`environnement`) ; `structure-analysis` gagne `carte` ASCII ; `support.js` supprime les amas non connectés au sol ; `vegetation.js` plante des arbres déterministes sur l'herbe hors emprise ; câblage dans onModel (mode inspire).

**Tech Stack:** Node.js existant, sharp, node:test.

## Global Constraints

- Projection : u = x − z ; v = round((x+z)/2) − y ; tri peintre (x+z) puis y croissants ; face top = couleur, flanc = couleur ×0,6 ; fond RGB 235 ; scale 2 ; PNG via sharp raw
- Vision : champ `environnement { vegetation, arbres: "aucun"|"epars"|"dense", types_arbres, sol, ambiance }`
- carte ASCII : chiffres `round(h/hMax×9)`, une chaîne par ligne gridZ
- enforceSupport : BFS 6-adjacence depuis la couche y minimale ; retourne { blocks, removed }
- Végétation : chêne (oak_log 4-5 + houppier 3×3×2 + pointe), sapin (spruce_log 5-7, même houppier v1) ; plantée sur `grass_block` sommet de colonne, marge 2 autour de l'emprise exclue ; densités : dense 0,03 / epars 0,012 / aucun 0 ; déterministe via hash01
- Messages français ; tests node:test ; 127 tests existants intacts

---

### Task 1 : render.js

**Files:** Create `src/render.js` — Test `test/render.test.js`

**Interfaces:** `renderVoxels(blocks, colors, { scale = 2 }) → Promise<Buffer PNG>` (colors = Map bloc→[r,g,b], bloc inconnu → gris [128,128,128])

- [ ] **Step 1 : Test qui échoue** — `test/render.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { renderVoxels } = require('../src/render');

const colors = new Map([['stone', [125, 125, 125]], ['red_concrete', [200, 30, 30]]]);

test('rend un PNG déterministe contenant les couleurs des blocs', async () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 3, y: 2, z: 1, block: 'red_concrete' }
  ];
  const png1 = await renderVoxels(blocks, colors);
  const png2 = await renderVoxels(blocks, colors);
  assert.ok(Buffer.isBuffer(png1) && png1.length > 100);
  assert.ok(png1.equals(png2));
  const { data, info } = await sharp(png1).raw().toBuffer({ resolveWithObject: true });
  let hasGray = false;
  let hasRed = false;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === 125 && data[i + 1] === 125) hasGray = true;
    if (data[i] === 200 && data[i + 1] === 30) hasRed = true;
  }
  assert.ok(hasGray && hasRed, 'couleurs top absentes du rendu');
});

test('bloc inconnu rendu en gris moyen sans erreur', async () => {
  const png = await renderVoxels([{ x: 0, y: 0, z: 0, block: 'mystere' }], colors);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let found = false;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === 128 && data[i + 1] === 128 && data[i + 2] === 128) found = true;
  }
  assert.ok(found);
});
```

- [ ] **Step 2 : RED** — module introuvable.
- [ ] **Step 3 : Implémenter src/render.js**

```javascript
const sharp = require('sharp');

async function renderVoxels(blocks, colors, { scale = 2 } = {}) {
  if (!blocks.length) throw new Error('rien à rendre');
  const proj = (b) => ({ u: b.x - b.z, v: Math.round((b.x + b.z) / 2) - b.y });
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const b of blocks) {
    const { u, v } = proj(b);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const W = (maxU - minU + 2) * scale;
  const H = (maxV - minV + 3) * scale;
  const img = Buffer.alloc(W * H * 3, 235);
  const put = (px, py, [r, g, b2]) => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const xx = px + dx;
        const yy = py + dy;
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const i = (yy * W + xx) * 3;
        img[i] = r; img[i + 1] = g; img[i + 2] = b2;
      }
    }
  };
  const ordered = [...blocks].sort((a, b2) => (a.x + a.z) - (b2.x + b2.z) || a.y - b2.y);
  for (const b of ordered) {
    const c = colors.get(b.block) || [128, 128, 128];
    const { u, v } = proj(b);
    const px = (u - minU) * scale;
    const py = (v - minV) * scale;
    put(px, py, c);                                            // face top
    put(px, py + scale, [Math.round(c[0] * 0.6), Math.round(c[1] * 0.6), Math.round(c[2] * 0.6)]); // flanc
  }
  return sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

module.exports = { renderVoxels };
```

- [ ] **Step 4 : GREEN** (127 + 2 = 129).
- [ ] **Step 5 : Commit** — `git add src/render.js test/render.test.js && git commit -m "feat: rendu iso des voxels pour la vision"`

---

### Task 2 : Vision — environnement

**Files:** Modify `src/vision.js` — Test `test/vision.test.js`

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/vision.test.js` :

```javascript
test('le prompt système demande la description de l\'environnement', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(captured.system, /environnement/);
  assert.match(captured.system, /ambiance/);
  assert.match(captured.system, /types_arbres/);
});
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter** — dans le schéma du systemPrompt (après `zone_batiment`) :

```
  "environnement": { "vegetation": "...", "arbres": "aucun|epars|dense", "types_arbres": ["chene","sapin"], "sol": "...", "ambiance": "..." }
```
et dans les règles :
```
- environnement : décris TOUJOURS la végétation (densité d'arbres : aucun/epars/dense, essences parmi chene/sapin), la nature du sol et l'ambiance générale de la scène
```

- [ ] **Step 4 : GREEN** (130).
- [ ] **Step 5 : Commit** — `git add src/vision.js test/vision.test.js && git commit -m "feat: la vision décrit l'environnement (végétation, sol, ambiance)"`

---

### Task 3 : Carte ASCII + règle prompt

**Files:** Modify `src/structure-analysis.js`, `src/generator.js` — Tests `test/structure-analysis.test.js`, `test/generator.test.js`

- [ ] **Step 1 : Tests qui échouent** :

`test/structure-analysis.test.js` :
```javascript
test('carte ASCII 0-9 alignée sur la heightmap', () => {
  const blocks = [...slab(0, 31, 0, 23, 0, 'stone'), ...pillar(4, 4, 20), ...pillar(5, 5, 20)];
  const a = analyzeStructure(blocks);
  assert.strictEqual(a.carte.length, 12);
  assert.strictEqual(a.carte[0].length, 16);
  assert.strictEqual(a.carte[2][2], '9');            // pilier plein
  assert.strictEqual(a.carte[11][15], '0');          // dalle h=1 → round(1/20*9)=0
});
```
`test/generator.test.js` :
```javascript
test('le prompt architecte explique la carte ASCII', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000, structuralSummary: { carte: ['90', '00'] } });
  assert.match(captured.system, /vue de dessus ASCII/);
});
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter** — structure-analysis, juste avant le return :

```javascript
  const carte = heightmap.map((row) => row.map((h) => String(Math.min(9, Math.round((h / (hMax > 0 ? hMax : 1)) * 9)))).join(''));
```
et `carte` ajouté au return. Attention : `hMax` peut être `-Infinity` si aucune cellule — utiliser `const hSafe = Math.max(1, hMax)` si besoin pour rester fini.
generator, dans le bloc architecte du SYSTEM_PROMPT :
```
- La "carte" du résumé est une vue de dessus ASCII (0 = vide, 9 = point culminant) : reproduis ses masses et son agencement
```

- [ ] **Step 4 : GREEN** (132).
- [ ] **Step 5 : Commit** — `git add src/structure-analysis.js src/generator.js test/structure-analysis.test.js test/generator.test.js && git commit -m "feat: carte ASCII du résumé structurel lue par l'architecte"`

---

### Task 4 : support.js (gravité)

**Files:** Create `src/support.js` — Test `test/support.test.js` ; Modify `src/generator.js` (règle physique)

- [ ] **Step 1 : Tests qui échouent** — `test/support.test.js` :

```javascript
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
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter src/support.js**

```javascript
// Gravité : ne garder que les blocs connectés (6-adjacence) à la couche la plus basse
function enforceSupport(blocks) {
  if (blocks.length === 0) return { blocks: [], removed: 0 };
  const key = (x, y, z) => `${x},${y},${z}`;
  const all = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  const minY = Math.min(...blocks.map((b) => b.y));
  const kept = new Set();
  const queue = [];
  for (const b of blocks) {
    if (b.y === minY) {
      const k = key(b.x, b.y, b.z);
      kept.add(k);
      queue.push([b.x, b.y, b.z]);
    }
  }
  while (queue.length) {
    const [x, y, z] = queue.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nk = key(x + dx, y + dy, z + dz);
      if (all.has(nk) && !kept.has(nk)) {
        kept.add(nk);
        queue.push([x + dx, y + dy, z + dz]);
      }
    }
  }
  const out = blocks.filter((b) => kept.has(key(b.x, b.y, b.z)));
  return { blocks: out, removed: blocks.length - out.length };
}

module.exports = { enforceSupport };
```
generator SYSTEM_PROMPT, bloc architecte :
```
- GRAVITÉ : chaque bloc doit être supporté (chemin de blocs jusqu'au sol y=0) — aucun élément flottant
```
(Note : `Math.min(...blocks.map())` — spread jusqu'à ~100k éléments de bâtiment : acceptable ; si > 150k, remplacer par une boucle.)

- [ ] **Step 4 : GREEN** (135).
- [ ] **Step 5 : Commit** — `git add src/support.js test/support.test.js src/generator.js && git commit -m "feat: gravité — suppression des amas non supportés + règle prompt"`

---

### Task 5 : vegetation.js

**Files:** Create `src/vegetation.js` — Test `test/vegetation.test.js`

- [ ] **Step 1 : Tests qui échouent** — `test/vegetation.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { plantVegetation } = require('../src/vegetation');

function lawn(x1, x2, z1, z2, y = 5) {
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
    out.push({ x, y, z, block: 'grass_block' });
    out.push({ x, y: y - 1, z, block: 'dirt' });
  }
  return out;
}

test('déterministe, arbres avec tronc sur l\'herbe et houppier', () => {
  const terrain = lawn(0, 39, 0, 39);
  const a = plantVegetation(terrain, { seed: 7, densite: 0.05 });
  const b = plantVegetation(terrain, { seed: 7, densite: 0.05 });
  assert.deepStrictEqual(a, b);
  const trunks = a.filter((t) => /log$/.test(t.block));
  const leaves = a.filter((t) => /leaves$/.test(t.block));
  assert.ok(trunks.length > 0, 'aucun arbre');
  assert.ok(leaves.length > trunks.length, 'houppiers manquants');
  const bases = trunks.filter((t) => t.y === 6); // premier tronc au-dessus de l'herbe (y=5)
  assert.ok(bases.length > 0);
});

test('zone exclue (avec marge 2) sans arbres', () => {
  const terrain = lawn(0, 39, 0, 39);
  const trees = plantVegetation(terrain, { seed: 7, densite: 0.2, exclude: { x1: 10, x2: 20, z1: 10, z2: 20 } });
  assert.ok(trees.every((t) => t.x < 8 || t.x > 22 || t.z < 8 || t.z > 22 ||
    !/log$/.test(t.block) || t.x < 10 - 2 || t.x > 20 + 2 || t.z < 10 - 2 || t.z > 20 + 2));
  const trunkInZone = trees.some((t) => /log$/.test(t.block) && t.x >= 8 && t.x <= 22 && t.z >= 8 && t.z <= 22);
  assert.strictEqual(trunkInZone, false);
});

test('densité 0 : aucun arbre ; types sapin respectés', () => {
  const terrain = lawn(0, 19, 0, 19);
  assert.deepStrictEqual(plantVegetation(terrain, { seed: 1, densite: 0 }), []);
  const sapins = plantVegetation(terrain, { seed: 1, densite: 0.3, types: ['sapin'] });
  assert.ok(sapins.length > 0);
  assert.ok(sapins.every((t) => t.block === 'spruce_log' || t.block === 'spruce_leaves'));
});
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter src/vegetation.js**

```javascript
const { hash01 } = require('./subsurface');

const TREES = {
  chene: { trunk: 'oak_log', leaves: 'oak_leaves', hMin: 4, hMax: 5 },
  sapin: { trunk: 'spruce_log', leaves: 'spruce_leaves', hMin: 5, hMax: 7 }
};

function plantVegetation(terrainBlocks, { seed = 1, densite = 0.02, exclude = null, types = ['chene', 'sapin'] } = {}) {
  const list = types.map((t) => TREES[t]).filter(Boolean);
  if (densite <= 0 || list.length === 0) return [];
  const surf = new Map();
  for (const b of terrainBlocks) {
    if (b.block !== 'grass_block') continue;
    const k = `${b.x},${b.z}`;
    if (!surf.has(k) || b.y > surf.get(k)) surf.set(k, b.y);
  }
  const out = [];
  for (const [k, y] of surf) {
    const [x, z] = k.split(',').map(Number);
    if (exclude && x >= exclude.x1 - 2 && x <= exclude.x2 + 2 && z >= exclude.z1 - 2 && z <= exclude.z2 + 2) continue;
    if (hash01(seed ^ 0x7E01, x, 0, z) >= densite) continue;
    const t = list[Math.floor(hash01(seed ^ 0x7E02, x, 1, z) * list.length)];
    const h = t.hMin + Math.floor(hash01(seed ^ 0x7E03, x, 2, z) * (t.hMax - t.hMin + 1));
    for (let i = 1; i <= h; i++) out.push({ x, y: y + i, z, block: t.trunk });
    const topY = y + h;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          if (dx === 0 && dz === 0 && dy === 0) continue;
          out.push({ x: x + dx, y: topY + dy, z: z + dz, block: t.leaves });
        }
      }
    }
    out.push({ x, y: topY + 2, z, block: t.leaves });
  }
  return out;
}

module.exports = { plantVegetation };
```

- [ ] **Step 4 : GREEN** (138).
- [ ] **Step 5 : Commit** — `git add src/vegetation.js test/vegetation.test.js && git commit -m "feat: végétation procédurale déterministe (chênes, sapins)"`

---

### Task 6 : Câblage onModel (voir + planter)

**Files:** Modify `src/index.js`

- [ ] **Step 1 : Implémenter** — imports :

```javascript
const { renderVoxels } = require('./render');
const { enforceSupport } = require('./support');
const { plantVegetation } = require('./vegetation');
```

Dans `onModel`, branche inspire, remplacer le bloc entre `const summary = analyzeStructure(reference);` et le calcul de `bSize` par :

```javascript
      const summary = analyzeStructure(reference);
      const rendered = await renderVoxels(reference, blockColors);
      const sceneDesc = await analyzeImage(rendered.toString('base64'), 'image/png', {
        maxSize: dio.size_x, validBlocks
      });
      const env = (!sceneDesc.erreur && sceneDesc.environnement) || {};
      if (env.ambiance) bot.chat(`Ambiance : ${env.ambiance}`);
      const buildingDesc = sceneDesc.erreur
        ? { type_batiment: `reconstruction du modèle 3D (${ext})` }
        : sceneDesc;
      const generated = await generateStructure(buildingDesc, {
        timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: materiaux, structuralSummary: summary
      });
      const support = enforceSupport(generated);
      if (support.removed > 0) console.log(`[modele] gravité : ${support.removed} blocs flottants supprimés`);
      const building = support.blocks;
```
(La suite — bSize sur `building`, hillHeight, surfaceBlock, terrain, offX/offZ, topY, placed — inchangée.)
Après le calcul de `placed`, avant `blocks = terrain.concat(placed);` :

```javascript
      const densite = env.arbres === 'dense' ? 0.03 : env.arbres === 'epars' ? 0.012 : 0;
      const essences = (env.types_arbres || []).filter((t) => t === 'chene' || t === 'sapin');
      const trees = plantVegetation(terrain, {
        seed, densite,
        exclude: { x1: offX, x2: offX + bSize.x - 1, z1: offZ, z2: offZ + bSize.z - 1 },
        types: essences.length ? essences : ['chene']
      });
      blocks = terrain.concat(trees, placed);
```
(et retirer l'ancien `blocks = terrain.concat(placed);`). Message final enrichi :
```javascript
      bot.chat(`Reconstruction inspirée : bâtiment ${bSize.x}x${bSize.z}x${bSize.y} posé sur un relief de ${hillHeight} blocs, ${trees.length > 0 ? Math.round(trees.length / 14) + ' arbres plantés' : 'sans arbres'}.`);
```
(remplace l'ancien message Reconstruction inspirée).

- [ ] **Step 2 : Vérifier** — `npm test` (138) ; app + upload cube.obj (curl Pierre_Test) → logs : rendu → vision → Ambiance (si détectée) → gravité → proposition. Tuer/relancer l'app à la fin (la laisser tourner).
- [ ] **Step 3 : Commit** — `git add src/index.js && git commit -m "feat: l'IA voit le rendu du modèle et replante l'environnement"`

---

### Task 7 : Test comparatif Butron + revue finale + merge

- [ ] **Step 1** — test complet butron_castle.glb (driver type /tmp/full-test-butron.js) : vérifier dans les logs la description vision (type, palette claire, environnement arbres), gravité, arbres plantés ; construction complète ; coordonnées annoncées.
- [ ] **Step 2** — revue finale de branche (opus) ; fixes éventuels.
- [ ] **Step 3** — merge dans `main` ; l'utilisateur juge visuellement contre modele.png.

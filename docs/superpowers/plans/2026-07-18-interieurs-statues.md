# Intérieurs & statues — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bâtiments habitables (toits complets, étages, escaliers), décoration intérieure par un second passage LLM (palette intérieure filtrée mécaniquement), et statues fidèles via `!statue` (brut, couleurs vives, socle).

**Architecture:** Règles habitables dans le prompt architecte ; `INTERIOR_BLOCKS` dans blockcolors ; `src/decorator.js` (detectFloors mécanique + LLM sandboxé via runStructureCode + post-filtre positions libres) ; routage `mode=statue` (chat → webserver → onModel 4e argument) vers un pipeline brut sans IA avec socle.

**Tech Stack:** Node.js existant, node:test.

## Global Constraints

- Prompt : plus de « intérieurs creux » ; toit COMPLET fermé ; plancher tous les 5-6 blocs ; escalier par étage ; 2-4 pièces cloisonnées par étage
- INTERIOR_BLOCKS ⊂ valid_blocks.json (aucun nom hors liste blanche)
- Décorateur : le code LLM s'appelle `generateStructure()` (réutilise runStructureCode tel quel) ; post-filtre : bloc ∈ INTERIOR, coordonnées entières dans la boîte du bâtiment, position NON occupée ; échec API ou 0 plancher → `[]` silencieux (warn console)
- detectFloors : niveaux y où le nombre de blocs ≥ 30 % de (dims.x × dims.z), espacés d'au moins 3
- Statue : boîte 48×48×72 (x,z,y), palette `THEME_BLOCKS.couleurs_vives`, defaultBlock `white_concrete`, coquille (solid false), enforceSupport, socle `smooth_stone` 2 couches sous l'emprise +1 de marge, statue décalée de +2 en y ; ni terrain, ni sous-sol, ni vision, ni LLM
- Modes web autorisés : `diorama`, `statue` ; `onModel(username, buffer, ext, mode)`
- Tests node:test ; messages français ; 140 tests existants intacts

---

### Task 1 : Prompt bâtiments habitables

**Files:** Modify `src/generator.js` — Test `test/generator.test.js`

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/generator.test.js` :

```javascript
test('le prompt exige toits complets, planchers et escaliers', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  assert.match(captured.system, /toit.*COMPLET/i);
  assert.match(captured.system, /plancher/i);
  assert.match(captured.system, /escalier/i);
  assert.ok(!/intérieurs sont creux/.test(captured.system), 'règle creux encore présente');
});
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter** — dans SYSTEM_PROMPT, remplacer la ligne `- Les intérieurs sont creux (air)` par :

```
- Intérieurs HABITABLES : un plancher plein tous les 5-6 blocs de hauteur (oak_planks ou pierre selon le style), un escalier (stairs) reliant chaque étage, 2 à 4 pièces par étage séparées par des cloisons avec portes
- Le toit est COMPLET et fermé : il couvre toute l'emprise des murs sans aucun trou, pignons remplis
```

- [ ] **Step 4 : GREEN** (141).
- [ ] **Step 5 : Commit** — `git add src/generator.js test/generator.test.js && git commit -m "feat: bâtiments habitables — toits complets, étages, escaliers"`

---

### Task 2 : INTERIOR_BLOCKS + décorateur

**Files:** Modify `src/blockcolors.js` ; Create `src/decorator.js` — Tests `test/blockcolors.test.js`, `test/decorator.test.js`

**Interfaces:** `INTERIOR_BLOCKS: Set` ; `detectFloors(building) → number[]` ; `decorateInterior(building, description, { client, timeoutMs = 20000 }) → Promise<blocks>`

- [ ] **Step 1 : Tests qui échouent**

`test/blockcolors.test.js` :
```javascript
const { INTERIOR_BLOCKS } = require('../src/blockcolors');

test('la palette intérieure contient le mobilier et exclut le décor', () => {
  for (const b of ['bookshelf', 'lantern', 'chest', 'crafting_table', 'oak_door', 'red_wool']) {
    assert.ok(INTERIOR_BLOCKS.has(b), b);
  }
  for (const b of ['water', 'grass_block', 'oak_leaves', 'dirt']) {
    assert.ok(!INTERIOR_BLOCKS.has(b), `${b} n'est pas du mobilier`);
  }
  const valid = new Set(require('../data/valid_blocks.json'));
  for (const b of INTERIOR_BLOCKS) assert.ok(valid.has(b), `${b} hors liste blanche`);
});
```

`test/decorator.test.js` :
```javascript
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
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter**

`src/blockcolors.js` — après THEME_BLOCKS :
```javascript
// Mobilier et aménagement : autorisé UNIQUEMENT à l'intérieur des bâtiments
const INTERIOR_BLOCKS = new Set(['bookshelf', 'crafting_table', 'furnace', 'smoker', 'chest', 'barrel',
  'lantern', 'torch', 'wall_torch', 'glowstone', 'sea_lantern', 'chain', 'campfire', 'ladder',
  'flower_pot', 'hay_block', 'oak_door', 'spruce_door', 'dark_oak_door', 'birch_door', 'iron_door',
  'oak_trapdoor', 'spruce_trapdoor', 'oak_fence', 'spruce_fence', 'dark_oak_fence', 'birch_fence',
  'oak_stairs', 'spruce_stairs', 'dark_oak_stairs', 'birch_stairs', 'oak_slab', 'spruce_slab',
  'dark_oak_slab', 'stone_slab', 'glass_pane', 'iron_bars',
  'white_wool', 'red_wool', 'blue_wool', 'green_wool', 'yellow_wool', 'brown_wool', 'black_wool']);
```
et l'ajouter à `module.exports`.

`src/decorator.js` :
```javascript
const { withRetry, stripCodeFences } = require('./llm');
const { runStructureCode } = require('./generator');
const { INTERIOR_BLOCKS } = require('./blockcolors');

const MODEL = 'claude-sonnet-4-6';

function dimsOf(blocks) {
  const d = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    d.x = Math.max(d.x, b.x + 1);
    d.y = Math.max(d.y, b.y + 1);
    d.z = Math.max(d.z, b.z + 1);
  }
  return d;
}

function detectFloors(building) {
  if (building.length === 0) return [];
  const d = dimsOf(building);
  const perY = new Map();
  for (const b of building) perY.set(b.y, (perY.get(b.y) || 0) + 1);
  const footprint = d.x * d.z;
  const floors = [];
  for (let y = 0; y < d.y; y++) {
    if ((perY.get(y) || 0) >= footprint * 0.3) {
      if (floors.length === 0 || y - floors[floors.length - 1] >= 3) floors.push(y);
    }
  }
  return floors;
}

async function decorateInterior(building, description, { client, timeoutMs = 20000 } = {}) {
  const floors = detectFloors(building);
  if (!client || floors.length === 0) return [];
  const d = dimsOf(building);
  const occupied = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  try {
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: `Tu es décorateur d'intérieur Minecraft. Écris une fonction JavaScript pure generateStructure() retournant [{x, y, z, block}] : mobilier, rangements et éclairage posés SUR les planchers (y du plancher + 1), à l'intérieur des murs (marge de 1 bloc), pièces cohérentes (coin repas, bibliothèque, atelier, éclairage régulier aux murs). Blocs autorisés UNIQUEMENT : ${[...INTERIOR_BLOCKS].join(', ')}. Réponds UNIQUEMENT avec le code, sans texte autour.`,
      messages: [{
        role: 'user',
        content: `Bâtiment ${d.x}x${d.z}x${d.y} (x,z,y). Niveaux de plancher (y) : ${floors.join(', ')}. Style : ${description.type_batiment || 'bâtiment'}${description.style ? ' — ' + description.style : ''}. Écris generateStructure().`
      }]
    }), { retries: 1 });
    const code = stripCodeFences(response.content.find((b) => b.type === 'text').text);
    const raw = runStructureCode(code, timeoutMs);
    return raw.filter((b) => b && typeof b === 'object'
      && INTERIOR_BLOCKS.has(b.block)
      && Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.z)
      && b.x >= 0 && b.x < d.x && b.y >= 0 && b.y < d.y && b.z >= 0 && b.z < d.z
      && !occupied.has(`${b.x},${b.y},${b.z}`));
  } catch (err) {
    console.warn('[decorateur] indisponible :', err.message);
    return [];
  }
}

module.exports = { detectFloors, decorateInterior };
```
Note : dans le test de filtrage, la lantern à y=0 entre en collision avec la dalle (position occupée) → filtrée ✓ ; chest x=99 hors boîte ✓ ; diamond_ore ∉ INTERIOR ✓.

- [ ] **Step 4 : GREEN** (141 + 5 = 146).
- [ ] **Step 5 : Commit** — `git add src/blockcolors.js src/decorator.js test/blockcolors.test.js test/decorator.test.js && git commit -m "feat: palette intérieure et décorateur LLM filtré mécaniquement"`

---

### Task 3 : Câblage décorateur

**Files:** Modify `src/index.js`

- [ ] **Step 1 : Implémenter** — import `const { decorateInterior } = require('./decorator');`. Dans `onPhoto`, après `const blocks = await generateStructure(...)` :

```javascript
    const decor = await decorateInterior(blocks, description, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
    if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
    const meubles = blocks.concat(decor);
```
et proposeStructure reçoit `meubles` au lieu de `blocks`. Dans `onModel` (inspire), après `const building = support.blocks;` :

```javascript
      const decor = await decorateInterior(building, buildingDesc, { client: apiClient, timeoutMs: cfg.limits.sandbox_timeout_ms });
      if (decor.length > 0) bot.chat(`Décoration intérieure : ${decor.length} éléments.`);
      const furnished = building.concat(decor);
```
puis `bSize` et `placed` calculés sur `furnished` (renommer les usages de `building` en aval de ce point).

- [ ] **Step 2 : Vérifier** — `npm test` (146) ; live : app + upload chaumont webp en !photo (curl, `Pierre_Test`, sans mode) → logs : Décoration intérieure : N éléments (N > 0 attendu pour un château à étages) ; tuer/relancer l'app.
- [ ] **Step 3 : Commit** — `git add src/index.js && git commit -m "feat: décoration intérieure branchée sur les deux pipelines de bâtiments"`

---

### Task 4 : !statue

**Files:** Modify `src/chat.js`, `src/webserver.js`, `src/index.js` — Tests `test/chat.test.js`, `test/webserver.test.js`

- [ ] **Step 1 : Tests qui échouent**

`test/chat.test.js` :
```javascript
test('!statue donne le lien mode=statue', () => {
  const { messages, handle } = setup();
  handle('Steve', '!statue');
  assert.match(messages[0], /upload\/Steve\?mode=statue/);
});
```
`test/webserver.test.js` :
```javascript
test('mode statue routé vers onModel avec le mode', async () => {
  let got = null;
  const app = createWebServer({
    onPhoto: async () => {}, onDiorama: async () => {},
    onModel: async (u, buf, ext, mode) => { got = { ext, mode }; return 'ok'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('mode', 'statue');
  fd.append('photo', new Blob(['v 0 0 0'], { type: 'application/octet-stream' }), 'sonic.obj');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(got, { ext: 'obj', mode: 'statue' });
  server.close();
});

test('le formulaire statue est servi', async () => {
  const app = createWebServer({ onPhoto: async () => {}, onDiorama: async () => {}, onModel: async () => {} });
  const server = await listen(app);
  const res = await fetch(`http://localhost:${server.address().port}/upload/Steve?mode=statue`);
  assert.match(await res.text(), /name="mode" value="statue"/);
  server.close();
});
```

- [ ] **Step 2 : RED**.
- [ ] **Step 3 : Implémenter**

chat.js, après `!diorama` :
```javascript
      if (cmd === '!statue') {
        bot.chat(`${username} : statue fidèle depuis un modèle 3D → http://${config.web.public_host}:${config.web.port}/upload/${username}?mode=statue`);
        return;
      }
```
webserver.js : `const mode = ['diorama', 'statue'].includes(req.query.mode) ? req.query.mode : '';` (GET) ; le `accept` élargi aux modèles quand `mode` est non vide ; POST : `message = await onModel(req.body.username, req.file.buffer, ext.slice(1), req.body.mode || '');`
index.js : signature `async function onModel(username, buffer, ext, mode)` ; tout en haut du corps (après le parse + warning + cleaned) :

```javascript
    if (mode === 'statue') {
      const colorsStatue = filterColors(blockColors, THEME_BLOCKS.couleurs_vives);
      const shell = voxelizeMesh(cleaned.triangles, {
        maxX: 48, maxY: 72, maxZ: 48, defaultBlock: 'white_concrete',
        colors: colorsStatue, zUp: ext === 'stl'
      });
      const statue = enforceSupport(shell).blocks.map((b) => ({ ...b, y: b.y + 2 }));
      let sx = 0;
      let sz = 0;
      for (const b of statue) { sx = Math.max(sx, b.x); sz = Math.max(sz, b.z); }
      const socle = [];
      for (let x = -1; x <= sx + 1; x++) for (let z = -1; z <= sz + 1; z++) for (let y = 0; y <= 1; y++) {
        socle.push({ x: x + 1, y, z: z + 1, block: 'smooth_stone' });
      }
      const statueBlocks = socle.concat(statue.map((b) => ({ ...b, x: b.x + 1, z: b.z + 1 })));
      bot.chat(`Statue voxelisée : ${sx + 1}x${sz + 1} sur socle.`);
      return proposeStructure(username, statueBlocks, { type_batiment: `statue (${ext})` }, { maxSize: 96, maxBlocks: cfg.limits.max_blocks });
    }
```
(placé AVANT le calcul de palette délibérée — la statue n'utilise ni palette LLM ni vision).

- [ ] **Step 4 : GREEN** (146 + 3 = 149) — les 4 anciens tests webserver dont onModel à 3 arguments restent verts (4e argument ignoré par les fakes existants).
- [ ] **Step 5 : Vérifier live** — upload cube.obj avec mode=statue (curl) → « Statue voxelisée » + proposition.
- [ ] **Step 6 : Commit** — `git add src/chat.js src/webserver.js src/index.js test/chat.test.js test/webserver.test.js && git commit -m "feat: commande !statue — voxel fidèle couleurs vives sur socle"`

---

### Task 5 : E2E, revue finale, merge

- [ ] **Step 1** — `npm test` (149) ; `node scripts/e2e-diorama.js` (12/12 attendu) ; revue finale (opus) ; merge main ; app relancée.

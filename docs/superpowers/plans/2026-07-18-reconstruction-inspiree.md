# Reconstruction inspirée — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les modèles/photos deviennent des références : nettoyage des scans, analyse structurelle, reconstruction propre par le LLM, terrain lissé raccordé au monde, ancrage au sol, coordonnées annoncées.

**Architecture:** `meshclean` (composantes + crop percentile) → `voxelizeMesh` → `structure-analysis` (heightmap/tours/thèmes) → generator LLM « architecte » (résumé injecté) ; terrain reconstruit par `terrain.js` (interpolation bilinéaire du heightmap + fondu de bord + strates sous-sol) ; builder ancré au sol ; chat annonce l'emprise. Mode `"brut"` conservé via config.

**Tech Stack:** Node.js existant, node:test.

## Global Constraints

- `config.json` : `"reconstruction": "inspire"` (défaut) | `"brut"`
- meshclean : composantes < 3 % des triangles retirées (la plus grosse toujours gardée) ; crop au percentile 2-98 des centroïdes par axe
- analyse : grille 16×12 (x×z), tours = cellules de hauteur ≥ 80 % du max regroupées par adjacence
- terrain : interpolation bilinéaire du heightmap vers la taille réelle, fondu de bord cosinus sur 12 blocs (bord = hauteur 0), surface `grass_block` si thème végétal sinon bloc du thème, strates via `underground.fill`
- ancrage : origine y = premier bloc solide sous le joueur (+1), scan ≤ 24 blocs, repli floor(pos.y)
- annonce : « Emprise : (x1,z1) → (x2,z2), centre (cx,cz) » après le lancement
- Tests node:test, TDD ; messages français ; ne rien casser des 112 tests existants

---

### Task 1 : meshclean (composantes + crop percentile)

**Files:**
- Create: `src/meshclean.js` — Test: `test/meshclean.test.js`

**Interfaces:**
- Consumes: `triangles` de parseModel
- Produces: `cleanTriangles(triangles) → { triangles, removed }`

- [ ] **Step 1 : Test qui échoue** — `test/meshclean.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { cleanTriangles } = require('../src/meshclean');

function tri(x, y, z, s = 1, color = null) {
  return { a: [x, y, z], b: [x + s, y, z], c: [x, y, z + s], color };
}

function grid(x0, y0, z0, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(tri(x0 + (i % 10) * 1.0, y0, z0 + Math.floor(i / 10) * 1.0));
  return out;
}

test('retire une petite composante déconnectée', () => {
  const main = grid(0, 0, 0, 100);           // grande nappe connexe (sommets partagés)
  const junk = [tri(500, 500, 500), tri(500.5, 500, 500)]; // 2 % isolés et lointains
  const { triangles, removed } = cleanTriangles([...main, ...junk]);
  assert.strictEqual(removed, 2);
  assert.ok(triangles.every((t) => t.a[0] < 100));
});

test('le crop percentile resserre la boîte malgré un débris intégré', () => {
  const main = grid(0, 0, 0, 200);
  // débris CONNECTÉ en hauteur (relié par un sommet) : la composante ne le retire pas,
  // le crop des centroïdes oui
  const spike = [{ a: [0, 0, 0], b: [0, 300, 0], c: [1, 300, 0], color: null }];
  const { triangles } = cleanTriangles([...main, ...spike]);
  const maxY = Math.max(...triangles.map((t) => Math.max(t.a[1], t.b[1], t.c[1])));
  assert.ok(maxY < 100, `boîte non resserrée : maxY=${maxY}`);
});

test('sans débris : rien de retiré', () => {
  const main = grid(0, 0, 0, 50);
  const { triangles, removed } = cleanTriangles(main);
  assert.strictEqual(removed, 0);
  assert.strictEqual(triangles.length, 50);
});
```

- [ ] **Step 2 : RED** — module introuvable.

- [ ] **Step 3 : Implémenter src/meshclean.js**

```javascript
// Nettoyage des scans : composantes connexes (sommets partagés) + crop percentile
function cleanTriangles(triangles) {
  const total = triangles.length;
  if (total === 0) return { triangles, removed: 0 };

  const parent = [];
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const vkey = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;
  const vidx = new Map();
  const vertId = (p) => {
    const k = vkey(p);
    if (!vidx.has(k)) { vidx.set(k, parent.length); parent.push(parent.length); }
    return vidx.get(k);
  };
  const triVert = triangles.map((t) => {
    const ids = [vertId(t.a), vertId(t.b), vertId(t.c)];
    union(ids[0], ids[1]);
    union(ids[1], ids[2]);
    return ids[0];
  });
  const compOf = triVert.map((v) => find(v));
  const count = new Map();
  for (const r of compOf) count.set(r, (count.get(r) || 0) + 1);
  const biggest = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const kept = triangles.filter((t, i) => compOf[i] === biggest || count.get(compOf[i]) >= total * 0.03);

  // crop percentile 2-98 des centroïdes par axe
  const cent = kept.map((t) => [0, 1, 2].map((a) => (t.a[a] + t.b[a] + t.c[a]) / 3));
  const bounds = [0, 1, 2].map((a) => {
    const vals = cent.map((c) => c[a]).sort((x, y) => x - y);
    const at = (p) => vals[Math.max(0, Math.min(vals.length - 1, Math.floor(p * vals.length)))];
    return [at(0.02), at(0.98)];
  });
  const margin = bounds.map(([lo, hi]) => (hi - lo) * 0.05 + 1e-6);
  const final = kept.filter((t, i) =>
    [0, 1, 2].every((a) => cent[i][a] >= bounds[a][0] - margin[a] && cent[i][a] <= bounds[a][1] + margin[a])
  );
  return { triangles: final, removed: total - final.length };
}

module.exports = { cleanTriangles };
```

- [ ] **Step 4 : GREEN** — `npm test` (112 + 3 = 115).
- [ ] **Step 5 : Commit** — `git add src/meshclean.js test/meshclean.test.js && git commit -m "feat: nettoyage des scans (composantes + crop percentile)"`

---

### Task 2 : Analyse structurelle

**Files:**
- Create: `src/structure-analysis.js` — Test: `test/structure-analysis.test.js`

**Interfaces:**
- Consumes: blocs `[{x,y,z,block}]` ; `themeOfBlock` de src/palette.js
- Produces: `analyzeStructure(blocks, { gridX = 16, gridZ = 12 }) → { dims: {x,y,z}, heightmap: number[gridZ][gridX] (hauteurs max par cellule), footprint: (0|1)[gridZ][gridX], towers: [{cx, cz, radius, height}] (coordonnées blocs), themes: string[] }`

- [ ] **Step 1 : Test qui échoue** — `test/structure-analysis.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { analyzeStructure } = require('../src/structure-analysis');

function slab(x1, x2, z1, z2, y, block = 'stone') {
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y, z, block });
  return out;
}

function pillar(x, z, h, block = 'stone_bricks') {
  const out = [];
  for (let y = 0; y < h; y++) out.push({ x, y, z, block });
  return out;
}

test('dims, heightmap et footprint sur une dalle', () => {
  const blocks = slab(0, 31, 0, 23, 0, 'grass_block');
  const a = analyzeStructure(blocks);
  assert.deepStrictEqual(a.dims, { x: 32, y: 1, z: 24 });
  assert.strictEqual(a.heightmap.length, 12);
  assert.strictEqual(a.heightmap[0].length, 16);
  assert.ok(a.heightmap.every((row) => row.every((h) => h === 1)));
  assert.ok(a.footprint.every((row) => row.every((f) => f === 1)));
});

test('deux piliers hauts → deux tours aux bonnes positions', () => {
  const blocks = [
    ...slab(0, 31, 0, 23, 0, 'stone'),
    ...pillar(4, 4, 20), ...pillar(5, 4, 20), ...pillar(4, 5, 20), ...pillar(5, 5, 20),
    ...pillar(27, 19, 20), ...pillar(28, 19, 20), ...pillar(27, 20, 20), ...pillar(28, 20, 20)
  ];
  const a = analyzeStructure(blocks);
  assert.strictEqual(a.towers.length, 2);
  const sorted = a.towers.sort((t1, t2) => t1.cx - t2.cx);
  assert.ok(Math.abs(sorted[0].cx - 4.5) < 3 && Math.abs(sorted[0].cz - 4.5) < 3);
  assert.ok(Math.abs(sorted[1].cx - 27.5) < 3 && Math.abs(sorted[1].cz - 19.5) < 3);
  assert.strictEqual(sorted[0].height, 20);
});

test('themes liste les matières dominantes', () => {
  const blocks = [...slab(0, 15, 0, 11, 0, 'grass_block'), ...pillar(8, 6, 10, 'stone_bricks')];
  const a = analyzeStructure(blocks);
  assert.ok(a.themes.includes('vegetation'));
  assert.ok(a.themes.includes('maconnerie'));
});
```

- [ ] **Step 2 : RED** — module introuvable.

- [ ] **Step 3 : Implémenter src/structure-analysis.js**

```javascript
const { themeOfBlock } = require('./palette');

function analyzeStructure(blocks, { gridX = 16, gridZ = 12 } = {}) {
  const dims = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    dims.x = Math.max(dims.x, b.x + 1);
    dims.y = Math.max(dims.y, b.y + 1);
    dims.z = Math.max(dims.z, b.z + 1);
  }
  const heightmap = Array.from({ length: gridZ }, () => new Array(gridX).fill(0));
  const themeCount = new Map();
  for (const b of blocks) {
    const gx = Math.min(gridX - 1, Math.floor((b.x / dims.x) * gridX));
    const gz = Math.min(gridZ - 1, Math.floor((b.z / dims.z) * gridZ));
    heightmap[gz][gx] = Math.max(heightmap[gz][gx], b.y + 1);
    const t = themeOfBlock(b.block);
    if (t) themeCount.set(t, (themeCount.get(t) || 0) + 1);
  }
  const footprint = heightmap.map((row) => row.map((h) => (h > 0 ? 1 : 0)));

  // tours : cellules ≥ 80 % de la hauteur max, regroupées par adjacence (4-voisins)
  const hMax = Math.max(...heightmap.flat());
  const tall = heightmap.map((row) => row.map((h) => hMax > 1 && h >= hMax * 0.8));
  const seen = heightmap.map((row) => row.map(() => false));
  const towers = [];
  for (let z = 0; z < gridZ; z++) {
    for (let x = 0; x < gridX; x++) {
      if (!tall[z][x] || seen[z][x]) continue;
      const cells = [];
      const stack = [[x, z]];
      seen[z][x] = true;
      while (stack.length) {
        const [cx, cz] = stack.pop();
        cells.push([cx, cz]);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx >= 0 && nx < gridX && nz >= 0 && nz < gridZ && tall[nz][nx] && !seen[nz][nx]) {
            seen[nz][nx] = true;
            stack.push([nx, nz]);
          }
        }
      }
      const cellW = dims.x / gridX;
      const cellD = dims.z / gridZ;
      const cx = cells.reduce((s, c) => s + (c[0] + 0.5) * cellW, 0) / cells.length;
      const cz = cells.reduce((s, c) => s + (c[1] + 0.5) * cellD, 0) / cells.length;
      const height = Math.max(...cells.map(([gx2, gz2]) => heightmap[gz2][gx2]));
      const radius = Math.max(1, Math.round(Math.sqrt((cells.length * cellW * cellD) / Math.PI)));
      towers.push({ cx: Math.round(cx * 10) / 10, cz: Math.round(cz * 10) / 10, radius, height });
    }
  }
  const themes = [...themeCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { dims, heightmap, footprint, towers, themes };
}

module.exports = { analyzeStructure };
```

- [ ] **Step 4 : GREEN** — note : sur la dalle seule, hMax = 1 → `hMax > 1` exclut les fausses tours ✓ ; sur le test piliers, la dalle (h=1 < 16) n'est pas « tall » ✓.
- [ ] **Step 5 : Commit** — `git add src/structure-analysis.js test/structure-analysis.test.js && git commit -m "feat: analyse structurelle (heightmap, tours, thèmes)"`

---

### Task 3 : Terrain lissé raccordé

**Files:**
- Create: `src/terrain.js` — Test: `test/terrain.test.js`

**Interfaces:**
- Consumes: heightmap de analyzeStructure ; `underground.fill`
- Produces: `terrainFromHeightmap(heightmap, { sizeX, sizeZ, maxHeight, underground, surfaceBlock = 'grass_block', taperWidth = 12 }) → blocks` — interpolation bilinéaire du heightmap (échelle maxHeight = hauteur bloc du max de la carte), fondu cosinus vers 0 sur `taperWidth` blocs aux quatre bords, surface = surfaceBlock, dessous via `underground.fill(x, y, z, depth, 'vegetation')` (null = cavité) ; sans underground : dirt (depth ≤ 2) puis stone

- [ ] **Step 1 : Test qui échoue** — `test/terrain.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { terrainFromHeightmap } = require('../src/terrain');

const flat = [[4, 4], [4, 4]]; // heightmap 2×2 uniforme

test('bords fondus à ~0, centre à pleine hauteur', () => {
  const blocks = terrainFromHeightmap(flat, { sizeX: 60, sizeZ: 60, maxHeight: 12, taperWidth: 12 });
  const heightAt = (x, z) => Math.max(-1, ...blocks.filter((b) => b.x === x && b.z === z).map((b) => b.y));
  assert.ok(heightAt(30, 30) >= 10, `centre trop bas : ${heightAt(30, 30)}`);
  assert.ok(heightAt(0, 30) <= 1, `bord ouest non fondu : ${heightAt(0, 30)}`);
  assert.ok(heightAt(30, 59) <= 1, `bord sud non fondu : ${heightAt(30, 59)}`);
});

test('surface en grass_block, strates dessous', () => {
  const blocks = terrainFromHeightmap(flat, { sizeX: 40, sizeZ: 40, maxHeight: 10, taperWidth: 8 });
  const col = blocks.filter((b) => b.x === 20 && b.z === 20).sort((a, b) => b.y - a.y);
  assert.strictEqual(col[0].block, 'grass_block');
  assert.strictEqual(col[1].block, 'dirt');
  assert.strictEqual(col[2].block, 'dirt');
  assert.strictEqual(col[3].block, 'stone');
  assert.strictEqual(col[col.length - 1].y, 0); // plein jusqu'au sol
});

test('underground appliqué avec le thème vegetation', () => {
  const calls = [];
  const underground = { fill: (x, y, z, depth, theme) => { calls.push(theme); return 'stone'; } };
  terrainFromHeightmap(flat, { sizeX: 20, sizeZ: 20, maxHeight: 6, taperWidth: 4, underground });
  assert.ok(calls.length > 0);
  assert.ok(calls.every((t) => t === 'vegetation'));
});

test('interpolation bilinéaire : pente douce entre cellules inégales', () => {
  const slope = [[0, 8], [0, 8]];
  const blocks = terrainFromHeightmap(slope, { sizeX: 80, sizeZ: 20, maxHeight: 8, taperWidth: 0 });
  const h = (x) => Math.max(0, ...blocks.filter((b) => b.x === x && b.z === 10).map((b) => b.y));
  assert.ok(h(20) < h(40) && h(40) < h(60), `pas de pente : ${h(20)} ${h(40)} ${h(60)}`);
});
```

- [ ] **Step 2 : RED** — module introuvable.

- [ ] **Step 3 : Implémenter src/terrain.js**

```javascript
function terrainFromHeightmap(heightmap, { sizeX, sizeZ, maxHeight, underground, surfaceBlock = 'grass_block', taperWidth = 12 }) {
  const gz = heightmap.length;
  const gx = heightmap[0].length;
  const hmMax = Math.max(...heightmap.flat()) || 1;

  function sample(u, v) { // bilinéaire, u/v ∈ [0,1]
    const fx = u * (gx - 1);
    const fz = v * (gz - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(gx - 1, x0 + 1);
    const z1 = Math.min(gz - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const a = heightmap[z0][x0] * (1 - tx) + heightmap[z0][x1] * tx;
    const b = heightmap[z1][x0] * (1 - tx) + heightmap[z1][x1] * tx;
    return (a * (1 - tz) + b * tz) / hmMax;
  }

  function taper(x, z) {
    if (taperWidth <= 0) return 1;
    const d = Math.min(x, z, sizeX - 1 - x, sizeZ - 1 - z);
    if (d >= taperWidth) return 1;
    return (1 - Math.cos((Math.PI * d) / taperWidth)) / 2;
  }

  const blocks = [];
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const h = Math.round(sample(x / (sizeX - 1), z / (sizeZ - 1)) * maxHeight * taper(x, z));
      if (h <= 0) continue;
      blocks.push({ x, y: h, z, block: surfaceBlock });
      for (let y = h - 1; y >= 0; y--) {
        const depth = h - y;
        if (underground) {
          const filled = underground.fill(x, y, z, depth, 'vegetation');
          if (filled !== null) blocks.push({ x, y, z, block: filled });
        } else {
          blocks.push({ x, y, z, block: depth <= 2 ? 'dirt' : 'stone' });
        }
      }
    }
  }
  return blocks;
}

module.exports = { terrainFromHeightmap };
```

- [ ] **Step 4 : GREEN** — vérifier le test strates : surface à y=h, dirt à h-1/h-2, stone ensuite, dernier bloc y=0 ✓.
- [ ] **Step 5 : Commit** — `git add src/terrain.js test/terrain.test.js && git commit -m "feat: terrain lissé par heightmap avec fondu de bord"`

---

### Task 4 : Générateur « architecte » (résumé structurel)

**Files:**
- Modify: `src/generator.js` — Test: `test/generator.test.js`

**Interfaces:**
- Produces: `generateStructure(description, { …, structuralSummary })` — si fourni, le contenu utilisateur reçoit un bloc « Résumé structurel de la référence » (JSON) et le SYSTEM_PROMPT gagne la règle architecte

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/generator.test.js` :

```javascript
test('injecte le résumé structurel dans le prompt', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  const structuralSummary = { dims: { x: 40, y: 25, z: 30 }, towers: [{ cx: 5, cz: 5, radius: 3, height: 25 }] };
  await generateStructure({ type_batiment: 'château' }, { client, timeoutMs: 5000, structuralSummary });
  assert.match(captured.messages[0].content, /Résumé structurel/);
  assert.match(captured.messages[0].content, /"height":25/);
  assert.match(captured.system, /architecte/i);
});
```

- [ ] **Step 2 : RED**.

- [ ] **Step 3 : Implémenter** — dans `src/generator.js` : ajouter à la fin du SYSTEM_PROMPT :

```
Rôle d'architecte (quand un résumé structurel est fourni) :
- Le résumé décrit une référence réelle : respecte ses masses — emprise (footprint), carte de hauteurs, position/hauteur/rayon des tours
- Reconstruis PROPREMENT en vocabulaire Minecraft : murs droits et pleins, créneaux, arches, fenêtres alignées, toits cohérents — jamais le bruit du scan
- Reste dans dims ; les tours sont cylindriques aux positions données
```

Et dans `generateStructure`, la construction du contenu utilisateur :

```javascript
  const summarySection = structuralSummary
    ? `\n\nRésumé structurel de la référence (respecte ces masses) :\n${JSON.stringify(structuralSummary)}`
    : '';
```
(paramètre `structuralSummary` ajouté à la destructuration, section insérée avant `blocksSection` dans le template du content).

- [ ] **Step 4 : GREEN** — tous les tests generator existants inchangés.
- [ ] **Step 5 : Commit** — `git add src/generator.js test/generator.test.js && git commit -m "feat: prompt architecte avec résumé structurel"`

---

### Task 5 : Ancrage au sol (builder)

**Files:**
- Modify: `src/builder.js` — Test: `test/builder.test.js`

**Interfaces:**
- Produces: `groundLevelAt(pos) → y` (scan du premier bloc non-air sous `floor(pos.y)`, ≤ 24 blocs, retourne y_bloc + 1 ; repli `Math.floor(pos.y)`) ; `computeOrigin` utilise `groundLevelAt(playerPos)` pour l'axe y

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/builder.test.js` :

```javascript
test('computeOrigin ancre y au sol même si le joueur vole', () => {
  const bot = fakeBot();
  bot.blockAt = (v) => ({ name: v.y <= -61 ? 'grass_block' : 'air' });
  const b = new Builder(bot, { maxBlocks: 100000 });
  const origin = b.computeOrigin({ x: 0.5, y: -49.5, z: 0.5 }, 0, { x: 4, y: 3, z: 4 });
  assert.strictEqual(origin.y, -60); // premier solide à -61 → surface -60
});

test('groundLevelAt replie sur floor(pos.y) si aucun sol à portée', () => {
  const bot = fakeBot();
  bot.blockAt = () => ({ name: 'air' });
  const b = new Builder(bot, { maxBlocks: 100000 });
  assert.strictEqual(b.groundLevelAt({ x: 0, y: -49.5, z: 0 }), -50);
});
```

- [ ] **Step 2 : RED** — origin.y vaut -50 (floor du vol).

- [ ] **Step 3 : Implémenter** — dans `src/builder.js` :

```javascript
  groundLevelAt(pos) {
    const px = Math.floor(pos.x);
    const pz = Math.floor(pos.z);
    const start = Math.floor(pos.y);
    for (let y = start; y >= start - 24; y--) {
      const b = this.bot.blockAt(new Vec3(px, y, pz));
      if (b && b.name !== 'air') return y + 1;
    }
    return start;
  }
```

et dans `computeOrigin`, remplacer `const y = Math.floor(playerPos.y);` par `const y = this.groundLevelAt(playerPos);`.
Attention : le fakeBot par défaut (`blockAt: () => ({ name: 'air' })`) fait replier `groundLevelAt` sur `floor(pos.y)` → les tests computeOrigin existants (joueur posé à y=-60.0) restent inchangés ✓.

- [ ] **Step 4 : GREEN** — tous verts.
- [ ] **Step 5 : Commit** — `git add src/builder.js test/builder.test.js && git commit -m "feat: origine ancrée au sol réel (fini les constructions flottantes)"`

---

### Task 6 : Annonce d'emprise (chat)

**Files:**
- Modify: `src/chat.js` — Test: `test/chat.test.js`

**Interfaces:**
- Produces: après le message « lancée », un second message « Emprise : (x1,z1) → (x2,z2), centre (cx,cz) »

- [ ] **Step 1 : Test qui échoue** — ajouter à `test/chat.test.js` :

```javascript
test('!go annonce l\'emprise et le centre', () => {
  const { messages, pending, handle } = setup();
  pending.set('Steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 10, y: 5, z: 8 },
    description: { type_batiment: 'test' }
  });
  handle('Steve', '!go');
  const m = messages.join(' | ');
  assert.match(m, /Emprise : \(0,-9\) → \(9,-2\), centre \(5,-5\)/);
});
```
(Fake builder : origin `{ x: 0, y: -60, z: -9 }`, size 10×8 → coins (0,-9)→(9,-2) ; centre = origin + floor(size/2) = (5,-5).)

- [ ] **Step 2 : RED**.

- [ ] **Step 3 : Implémenter** — dans le `launch` de `!go` (src/chat.js), après le bot.chat « lancée » :

```javascript
          bot.chat(`Emprise : (${origin.x},${origin.z}) → (${origin.x + p.size.x - 1},${origin.z + p.size.z - 1}), centre (${origin.x + Math.floor(p.size.x / 2)},${origin.z + Math.floor(p.size.z / 2)})`);
```

- [ ] **Step 4 : GREEN** (corriger l'attendu du test au besoin selon le calcul ci-dessus — le code fait foi : centre (5,-5)).
- [ ] **Step 5 : Commit** — `git add src/chat.js test/chat.test.js && git commit -m "feat: annonce de l'emprise après !go"`

---

### Task 7 : Câblage mode « inspire » dans index.js

**Files:**
- Modify: `src/index.js`, `config.json`

**Interfaces:**
- Consumes: cleanTriangles, analyzeStructure, terrainFromHeightmap, generateStructure(structuralSummary), composite
- Produces: `config.reconstruction = "inspire"` ; `onModel` mode inspire : clean → voxel brut (géologique, palette) → analyse → bâtiment LLM (résumé + matériaux) → terrain lissé depuis le heightmap (hauteur max ≈ 1/3 de dims.y, bornée 8..24) → composite du bâtiment posé sur le sommet du terrain au centre ; mode brut : pipeline actuel inchangé

- [ ] **Step 1 : config.json** — ajouter `"reconstruction": "inspire"` au niveau racine.

- [ ] **Step 2 : Implémenter dans src/index.js** — imports :

```javascript
const { cleanTriangles } = require('./meshclean');
const { analyzeStructure } = require('./structure-analysis');
const { terrainFromHeightmap } = require('./terrain');
```

Dans `onModel`, après `parseModel` et le warning :

```javascript
    const cleaned = cleanTriangles(triangles);
    if (cleaned.removed > 0) bot.chat(`Nettoyage du scan : ${cleaned.removed} triangles de débris ignorés.`);
    const seed = Math.floor(Math.random() * 2 ** 31);
    console.log(`[modele] graine sous-sol : ${seed}`);
    const underground = createUnderground({ seed, maxY: dio.max_y });
    // voxelisation de référence (sert d'analyse en mode inspire, de rendu en mode brut)
    const colored = cleaned.triangles.filter((t) => t.color);
    let colors = colorsBati;
    if (colored.length > 0) {
      const step = Math.max(1, Math.floor(colored.length / 4000));
      const samples = [];
      for (let i = 0; i < colored.length; i += step) samples.push(colored[i].color);
      colors = await deliberatePalette(samples, colorsBati, `modèle 3D scanné (${ext})`);
    }
    const reference = voxelizeMesh(cleaned.triangles, {
      maxX: dio.size_x, maxY: dio.max_y, maxZ: dio.size_z,
      defaultBlock: 'stone', colors, zUp: ext === 'stl',
      solid: true, underground, surfaceThemeOf: themeOfBlock
    });
    let blocks = reference;
    if ((cfg.reconstruction || 'inspire') === 'inspire') {
      const summary = analyzeStructure(reference);
      const building = await generateStructure(
        { type_batiment: `reconstruction fidèle du modèle 3D (${ext})` },
        { timeoutMs: cfg.limits.sandbox_timeout_ms, validBlocks: materiaux, structuralSummary: summary }
      );
      const bSize = { x: 0, y: 0, z: 0 };
      for (const b of building) {
        bSize.x = Math.max(bSize.x, b.x + 1);
        bSize.y = Math.max(bSize.y, b.y + 1);
        bSize.z = Math.max(bSize.z, b.z + 1);
      }
      const hillHeight = Math.max(8, Math.min(24, Math.round(summary.dims.y / 3)));
      const terrain = terrainFromHeightmap(summary.heightmap, {
        sizeX: dio.size_x, sizeZ: dio.size_z, maxHeight: hillHeight,
        underground, taperWidth: 12
      });
      const offX = Math.floor((dio.size_x - bSize.x) / 2);
      const offZ = Math.floor((dio.size_z - bSize.z) / 2);
      let topY = 0;
      for (const t of terrain) {
        if (t.x >= offX && t.x < offX + bSize.x && t.z >= offZ && t.z < offZ + bSize.z) {
          topY = Math.max(topY, t.y);
        }
      }
      const placed = building.map((b) => ({ x: b.x + offX, y: b.y + topY + 1, z: b.z + offZ, block: b.block }));
      blocks = terrain.concat(placed);
      bot.chat(`Reconstruction inspirée : bâtiment ${bSize.x}x${bSize.z}x${bSize.y} posé sur un relief de ${hillHeight} blocs.`);
    }
    return proposeStructure(username, blocks, { type_batiment: `modèle 3D (${ext})` }, { maxSize: Math.max(dio.size_x, dio.max_y, dio.size_z), maxBlocks: dio.max_blocks });
```
(Remplace l'ancien corps entre le warning et le proposeStructure ; l'ancienne voxelisation directe devient `reference`.)

- [ ] **Step 3 : Vérifier** — `npm test` tous verts ; démarrage app + upload cube.obj (curl, Pierre_Test) → logs montrent nettoyage/summary/proposition sans erreur ; tuer l'app.
- [ ] **Step 4 : Commit** — `git add src/index.js config.json && git commit -m "feat: mode reconstruction inspirée (analyse + bâtiment LLM + terrain lissé)"`

---

### Task 8 : E2E, revue finale, merge

- [ ] **Step 1** — `npm test` complet ; `node scripts/e2e-diorama.js` avec l'app démarrée (le cube en mode inspire : le LLM reconstruit une « boîte propre » sur colline — vérifier que le bilan reste PASS ; sinon adapter les regex du driver aux nouveaux messages, jamais l'inverse).
- [ ] **Step 2** — revue finale de branche (opus) + fixes éventuels.
- [ ] **Step 3** — merge dans `main`.

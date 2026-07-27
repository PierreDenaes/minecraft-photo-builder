# Mémoire auto-améliorante — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le bot capture chaque construction confirmée avec sa photo et son code, permet au joueur de noter (1-5), et injecte les 2-3 cas passés similaires les mieux notés en few-shot lors des générations suivantes.

**Architecture:** Nouveau module `src/memory.js` avec CLIP local (@xenova/transformers). Stockage `data/memoire/cases/` (JSON + JPG miniature + embedding binaire). Intégration à 3 points : `!go` (capture), `!note N` (nouvelle commande, notation), `onPhoto` (recherche similarité avant `generateStructure`, injection few-shot dans le prompt).

**Tech Stack:** Node.js CommonJS existant, node:test TDD, sharp (déjà présent), @xenova/transformers (nouvelle dep).

## Global Constraints

- Format id de cas : `YYYY-MM-DD-<4 hex>` (ex: `2026-07-27-a3f2`)
- Miniature : 256px max côté long, JPEG qualité 80, via `sharp`
- Embedding : Float32Array 512 dims (CLIP ViT-B/32), sérialisé en Buffer binaire
- Note valide : entier ∈ [1..5], sinon rejet silencieux (console.warn)
- Seuils findSimilar par défaut : `n=3`, `minNote=3`, `minSimilarity=0.5`
- Modèle CLIP téléchargé au premier lancement (~150 MB dans `~/.cache/huggingface/`)
- Fallback si CLIP indispo : filtre index par style+type_batiment, tri par note desc
- Tests node:test, TDD, messages français, ne rien casser des 358 tests existants
- CLIP mocké dans tous les tests via injection (`memory.__setEmbedder(fn)`)

---

### Task 1 : Ajout de la dépendance @xenova/transformers

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: dépendance `@xenova/transformers` disponible dans `require('@xenova/transformers')`

- [ ] **Step 1 : Installer la dépendance**

```bash
npm install @xenova/transformers
```

Vérifier que `package.json` contient bien la nouvelle ligne dans `dependencies`.

- [ ] **Step 2 : Vérifier que le require passe**

```bash
node -e "console.log(typeof require('@xenova/transformers').pipeline)"
```
Expected: `function`

- [ ] **Step 3 : Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: ajout @xenova/transformers pour CLIP local"
```

---

### Task 2 : Structure de stockage et helpers de bas niveau

**Files:**
- Create: `src/memory.js` (squelette avec constantes de chemins)
- Create: `test/memory.test.js`

**Interfaces:**
- Consumes: rien (module racine)
- Produces:
  - `memory.CASES_DIR` — chemin absolu `data/memoire/cases/`
  - `memory.INDEX_PATH` — chemin absolu `data/memoire/index.json`
  - `memory.__ensureDirs()` — crée les dossiers si absents (idempotent)
  - `memory.__generateId()` — retourne `YYYY-MM-DD-<4 hex>` avec date du jour

- [ ] **Step 1 : Test qui échoue** — `test/memory.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const memory = require('../src/memory');

test('__ensureDirs crée data/memoire/cases/ si absent', () => {
  // nettoyer avant
  if (fs.existsSync(memory.CASES_DIR)) fs.rmSync(path.dirname(memory.CASES_DIR), { recursive: true });
  memory.__ensureDirs();
  assert.ok(fs.existsSync(memory.CASES_DIR));
  assert.ok(fs.existsSync(path.dirname(memory.INDEX_PATH)));
});

test('__generateId retourne YYYY-MM-DD-<4 hex>', () => {
  const id = memory.__generateId();
  assert.match(id, /^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/);
});

test('__generateId retourne des ids uniques sur 10 appels', () => {
  const ids = new Set();
  for (let i = 0; i < 10; i++) ids.add(memory.__generateId());
  assert.strictEqual(ids.size, 10);
});
```

- [ ] **Step 2 : RED** — module introuvable.

```bash
node --test test/memory.test.js
```
Expected: 3 tests failing (`Cannot find module '../src/memory'`).

- [ ] **Step 3 : Implémenter `src/memory.js` (squelette)**

```javascript
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'data', 'memoire');
const CASES_DIR = path.join(ROOT, 'cases');
const INDEX_PATH = path.join(ROOT, 'index.json');

function __ensureDirs() {
  fs.mkdirSync(CASES_DIR, { recursive: true });
}

function __generateId() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(2).toString('hex');
  return `${date}-${rand}`;
}

module.exports = { CASES_DIR, INDEX_PATH, __ensureDirs, __generateId };
```

- [ ] **Step 4 : GREEN**

```bash
node --test test/memory.test.js
```
Expected: 3/3 pass.

- [ ] **Step 5 : Commit**

```bash
git add src/memory.js test/memory.test.js
git commit -m "feat(memory): squelette + helpers de chemins et génération d'id"
```

---

### Task 3 : Abstraction CLIP avec injection pour tests

**Files:**
- Modify: `src/memory.js`
- Modify: `test/memory.test.js`

**Interfaces:**
- Consumes: `@xenova/transformers` (à `warmup`)
- Produces:
  - `memory.warmup()` — charge le pipeline CLIP en async (non-bloquant)
  - `memory.__setEmbedder(fn)` — injection de test, remplace l'embedder par une fonction déterministe
  - `memory.__embed(buffer)` — retourne un `Float32Array` de 512 flottants (via CLIP ou l'injectée)
  - `memory.__isReady()` — booléen : embedder disponible

- [ ] **Step 1 : Tests qui échouent** — ajouter à `test/memory.test.js` :

```javascript
test('avant warmup et sans injection : __isReady est false', () => {
  memory.__setEmbedder(null);  // reset
  assert.strictEqual(memory.__isReady(), false);
});

test('après __setEmbedder : __isReady est true et __embed retourne Float32Array 512', async () => {
  const fake = (buf) => {
    const out = new Float32Array(512);
    for (let i = 0; i < 512; i++) out[i] = (buf[i % buf.length] || 0) / 255;
    return out;
  };
  memory.__setEmbedder(fake);
  assert.strictEqual(memory.__isReady(), true);
  const emb = await memory.__embed(Buffer.from([1, 2, 3]));
  assert.ok(emb instanceof Float32Array);
  assert.strictEqual(emb.length, 512);
});

test('__embed sans embedder → throw explicite', async () => {
  memory.__setEmbedder(null);
  await assert.rejects(memory.__embed(Buffer.from([1])), /embedder non disponible/);
});
```

- [ ] **Step 2 : RED** — méthodes absentes.

- [ ] **Step 3 : Implémenter dans `src/memory.js`**

Ajouter en tête (après les requires) :

```javascript
let embedder = null;  // fonction (buffer) → Promise<Float32Array>

function __setEmbedder(fn) { embedder = fn; }
function __isReady() { return embedder !== null; }

async function __embed(buffer) {
  if (!embedder) throw new Error('embedder non disponible');
  return embedder(buffer);
}

async function warmup() {
  try {
    const { pipeline } = require('@xenova/transformers');
    const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
    embedder = async (buffer) => {
      const result = await extractor(buffer, { pooling: 'mean', normalize: true });
      return new Float32Array(result.data);
    };
    console.log('[memory] CLIP prêt');
  } catch (err) {
    console.warn('[memory] CLIP indispo :', err.message);
  }
}
```

Exporter aussi `warmup`, `__setEmbedder`, `__isReady`, `__embed`.

- [ ] **Step 4 : GREEN**

```bash
node --test test/memory.test.js
```
Expected: 6/6 pass.

- [ ] **Step 5 : Commit**

```bash
git add src/memory.js test/memory.test.js
git commit -m "feat(memory): warmup CLIP + injection embedder pour tests"
```

---

### Task 4 : `saveCase` — capture d'un nouveau cas

**Files:**
- Modify: `src/memory.js`
- Modify: `test/memory.test.js`
- Create: `test/fixtures/memory/photo-small.jpg` (32×32 JPEG factice)

**Interfaces:**
- Consumes: `__embed`, `sharp`
- Produces: `saveCase({ photo, description, code }) → Promise<string>` (retourne `id`)

Écrit `<id>.json`, `<id>.jpg`, `<id>.emb` et met à jour `index.json`.

- [ ] **Step 1 : Créer la fixture**

```bash
node -e "require('sharp')({ create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 150, b: 200 } } }).jpeg().toFile('test/fixtures/memory/photo-small.jpg')"
```

Vérifier : `test/fixtures/memory/photo-small.jpg` fait ~500 bytes.

- [ ] **Step 2 : Tests qui échouent** — ajouter à `test/memory.test.js` :

```javascript
const { rmSync } = require('node:fs');

function resetMemoryDir() {
  if (fs.existsSync(memory.CASES_DIR)) rmSync(path.dirname(memory.CASES_DIR), { recursive: true });
  memory.__ensureDirs();
}

function fakeEmbedder() {
  return (buf) => {
    const out = new Float32Array(512);
    for (let i = 0; i < 512; i++) out[i] = (buf[i % buf.length] || 0) / 255;
    return out;
  };
}

test('saveCase crée les 3 fichiers (.json, .jpg, .emb) et met à jour index.json', async () => {
  resetMemoryDir();
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({
    photo,
    description: { style: 'medieval', type_batiment: 'maison', palette_blocs: {} },
    code: 'function generateStructure() { return []; }'
  });
  assert.match(id, /^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/);
  assert.ok(fs.existsSync(path.join(memory.CASES_DIR, `${id}.json`)));
  assert.ok(fs.existsSync(path.join(memory.CASES_DIR, `${id}.jpg`)));
  assert.ok(fs.existsSync(path.join(memory.CASES_DIR, `${id}.emb`)));
  const index = JSON.parse(fs.readFileSync(memory.INDEX_PATH, 'utf8'));
  assert.strictEqual(index.length, 1);
  assert.strictEqual(index[0].id, id);
  assert.strictEqual(index[0].style, 'medieval');
  assert.strictEqual(index[0].type_batiment, 'maison');
  assert.strictEqual(index[0].note, null);
});

test('saveCase produit une miniature <= 256px côté long', async () => {
  resetMemoryDir();
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa' }, code: '' });
  const thumb = fs.readFileSync(path.join(memory.CASES_DIR, `${id}.jpg`));
  const meta = await require('sharp')(thumb).metadata();
  assert.ok(Math.max(meta.width, meta.height) <= 256);
});

test('saveCase écrit l\'embedding en Float32Array (2048 bytes = 512*4)', async () => {
  resetMemoryDir();
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa' }, code: '' });
  const embBuf = fs.readFileSync(path.join(memory.CASES_DIR, `${id}.emb`));
  assert.strictEqual(embBuf.length, 512 * 4);
});
```

- [ ] **Step 3 : RED** — `saveCase` n'existe pas.

- [ ] **Step 4 : Implémenter `saveCase` dans `src/memory.js`**

```javascript
const sharp = require('sharp');

async function saveCase({ photo, description, code }) {
  __ensureDirs();
  const id = __generateId();
  // miniature 256px max côté long
  const thumbBuf = await sharp(photo).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync(path.join(CASES_DIR, `${id}.jpg`), thumbBuf);
  // embedding (calculé sur la miniature pour cohérence et rapidité)
  const emb = await __embed(thumbBuf);
  fs.writeFileSync(path.join(CASES_DIR, `${id}.emb`), Buffer.from(emb.buffer));
  // json
  const caseObj = {
    id,
    date: new Date().toISOString(),
    style: description.style || 'autre',
    type_batiment: description.type_batiment || 'inconnu',
    description,
    code,
    note: null
  };
  fs.writeFileSync(path.join(CASES_DIR, `${id}.json`), JSON.stringify(caseObj, null, 2));
  // index (créé si absent)
  const index = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : [];
  index.push({ id, date: caseObj.date, style: caseObj.style, type_batiment: caseObj.type_batiment, note: null });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return id;
}
```

Ajouter `saveCase` à `module.exports`.

- [ ] **Step 5 : GREEN**

```bash
node --test test/memory.test.js
```
Expected: 9/9 pass.

- [ ] **Step 6 : Commit**

```bash
git add src/memory.js test/memory.test.js test/fixtures/memory/photo-small.jpg
git commit -m "feat(memory): saveCase (json + miniature 256px + embedding CLIP)"
```

---

### Task 5 : `updateNote` — notation d'un cas

**Files:**
- Modify: `src/memory.js`
- Modify: `test/memory.test.js`

**Interfaces:**
- Consumes: fichiers créés par `saveCase`
- Produces: `updateNote(id, note) → void` — met à jour `note` dans `<id>.json` et dans `index.json`

- [ ] **Step 1 : Tests qui échouent** — ajouter à `test/memory.test.js` :

```javascript
test('updateNote met à jour la note dans le JSON du cas et dans l\'index', async () => {
  resetMemoryDir();
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'medieval', type_batiment: 'maison' }, code: '' });
  memory.updateNote(id, 4);
  const caseJson = JSON.parse(fs.readFileSync(path.join(memory.CASES_DIR, `${id}.json`), 'utf8'));
  assert.strictEqual(caseJson.note, 4);
  const index = JSON.parse(fs.readFileSync(memory.INDEX_PATH, 'utf8'));
  assert.strictEqual(index.find((e) => e.id === id).note, 4);
});

test('updateNote sur id inexistant : no-op silencieux (pas d\'exception)', () => {
  resetMemoryDir();
  assert.doesNotThrow(() => memory.updateNote('2020-01-01-ffff', 3));
});

test('updateNote rejette une note hors [1..5] silencieusement', async () => {
  resetMemoryDir();
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'medieval', type_batiment: 'maison' }, code: '' });
  memory.updateNote(id, 7);
  const caseJson = JSON.parse(fs.readFileSync(path.join(memory.CASES_DIR, `${id}.json`), 'utf8'));
  assert.strictEqual(caseJson.note, null);
});
```

- [ ] **Step 2 : RED** — `updateNote` n'existe pas.

- [ ] **Step 3 : Implémenter dans `src/memory.js`**

```javascript
function updateNote(id, note) {
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    console.warn(`[memory] note invalide (${note}), ignorée`);
    return;
  }
  const casePath = path.join(CASES_DIR, `${id}.json`);
  if (!fs.existsSync(casePath)) {
    console.warn(`[memory] cas ${id} introuvable, note ignorée`);
    return;
  }
  const caseObj = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  caseObj.note = note;
  fs.writeFileSync(casePath, JSON.stringify(caseObj, null, 2));
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const entry = index.find((e) => e.id === id);
  if (entry) entry.note = note;
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}
```

Ajouter à `module.exports`.

- [ ] **Step 4 : GREEN**

```bash
node --test test/memory.test.js
```
Expected: 12/12 pass.

- [ ] **Step 5 : Commit**

```bash
git add src/memory.js test/memory.test.js
git commit -m "feat(memory): updateNote (validation 1-5, no-op si id inconnu)"
```

---

### Task 6 : `findSimilar` — recherche par similarité CLIP

**Files:**
- Modify: `src/memory.js`
- Modify: `test/memory.test.js`

**Interfaces:**
- Consumes: `__embed`, index et fichiers `.emb`
- Produces: `findSimilar(photo, description, opts) → Promise<Array<{ id, similarity, note, description, code }>>`

Options : `{ n = 3, minNote = 3, minSimilarity = 0.5 }`.

Retourne les cas triés par similarité desc, taille ≤ n. Fallback si `__isReady() === false` : filtre index par style+type_batiment, tri par note desc.

- [ ] **Step 1 : Tests qui échouent** — ajouter à `test/memory.test.js` :

```javascript
async function seedCases() {
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id1 = await memory.saveCase({ photo, description: { style: 'medieval', type_batiment: 'maison' }, code: 'A' });
  memory.updateNote(id1, 5);
  const id2 = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa' }, code: 'B' });
  memory.updateNote(id2, 4);
  const id3 = await memory.saveCase({ photo, description: { style: 'medieval', type_batiment: 'maison' }, code: 'C' });
  memory.updateNote(id3, 2);  // en dessous du seuil
  return { id1, id2, id3, photo };
}

test('findSimilar sans cas en base retourne []', async () => {
  resetMemoryDir();
  memory.__setEmbedder(fakeEmbedder());
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const res = await memory.findSimilar(photo, { style: 'medieval', type_batiment: 'maison' });
  assert.deepStrictEqual(res, []);
});

test('findSimilar exclut les cas note < minNote', async () => {
  resetMemoryDir();
  const { id3, photo } = await seedCases();
  const res = await memory.findSimilar(photo, { style: 'medieval', type_batiment: 'maison' }, { minNote: 3, minSimilarity: 0 });
  assert.ok(res.every((r) => r.id !== id3), `id3 (note 2) présent dans ${JSON.stringify(res.map((r) => r.id))}`);
});

test('findSimilar retourne au plus n cas triés par similarité desc', async () => {
  resetMemoryDir();
  await seedCases();
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const res = await memory.findSimilar(photo, { style: 'medieval', type_batiment: 'maison' }, { n: 2, minSimilarity: 0 });
  assert.ok(res.length <= 2);
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].similarity >= res[i].similarity);
});

test('findSimilar sans CLIP : fallback métadonnées (filtre style, tri note desc)', async () => {
  resetMemoryDir();
  const { id1 } = await seedCases();
  memory.__setEmbedder(null);  // désactive CLIP
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const res = await memory.findSimilar(photo, { style: 'medieval', type_batiment: 'maison' }, { minNote: 3 });
  assert.ok(res.length >= 1);
  assert.strictEqual(res[0].id, id1);  // note 5 en tête
  assert.ok(res.every((r) => r.description.style === 'medieval'));
});
```

- [ ] **Step 2 : RED** — `findSimilar` n'existe pas.

- [ ] **Step 3 : Implémenter dans `src/memory.js`**

```javascript
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function loadIndex() {
  return fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : [];
}

function loadCase(id) {
  const p = path.join(CASES_DIR, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function loadEmbedding(id) {
  const p = path.join(CASES_DIR, `${id}.emb`);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

async function findSimilar(photo, description, opts = {}) {
  const { n = 3, minNote = 3, minSimilarity = 0.5 } = opts;
  const index = loadIndex();
  const eligible = index.filter((e) => e.note != null && e.note >= minNote);
  if (eligible.length === 0) return [];
  if (!__isReady()) {
    // fallback métadonnées : filtre style+type, tri note desc
    return eligible
      .filter((e) => e.style === description.style && e.type_batiment === description.type_batiment)
      .sort((a, b) => b.note - a.note)
      .slice(0, n)
      .map((e) => {
        const c = loadCase(e.id);
        return { id: e.id, similarity: 0, note: e.note, description: c.description, code: c.code };
      });
  }
  // mode CLIP : embed la nouvelle photo (miniature pour cohérence)
  const thumb = await sharp(photo).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  const targetEmb = await __embed(thumb);
  const scored = [];
  for (const e of eligible) {
    const emb = loadEmbedding(e.id);
    if (!emb) continue;
    const sim = cosineSimilarity(targetEmb, emb);
    if (sim < minSimilarity) continue;
    const c = loadCase(e.id);
    if (!c) continue;
    scored.push({ id: e.id, similarity: sim, note: e.note, description: c.description, code: c.code });
  }
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, n);
}
```

Ajouter `findSimilar` à `module.exports`.

- [ ] **Step 4 : GREEN**

```bash
node --test test/memory.test.js
```
Expected: 16/16 pass.

- [ ] **Step 5 : Commit**

```bash
git add src/memory.js test/memory.test.js
git commit -m "feat(memory): findSimilar (cosine CLIP + fallback métadonnées)"
```

---

### Task 7 : Intégration dans `chat.js` (`!go` capture, `!note N` note)

**Files:**
- Modify: `src/chat.js`
- Modify: `test/chat.test.js`

**Interfaces:**
- Consumes: `memory.saveCase`, `memory.updateNote`
- Produces: comportement des commandes `!go` et `!note N` étendu

À `!go` : appeler `memory.saveCase({ photo: pending.photo, description: pending.description, code: pending.code })` juste avant `builder.startBuild`, stocker le `buildId` dans `lastBuild` (variable de portée handler).

Nouvelle commande `!note N` : parse N ∈ [1..5], appelle `memory.updateNote(lastBuild.buildId, N)`, répond dans le chat.

- [ ] **Step 1 : Trouver la structure existante**

```bash
grep -n "!go\|pending\|startBuild" src/chat.js
```

Repérer le handler `!go` et la variable qui contient les données pending par joueur. Repérer aussi où sont stockés `photo`, `description`, `code` — si absents de `pending`, il faudra les faire passer depuis `index.js` (mise à jour de `proposeStructure` dans `index.js` : ajouter ces champs à `pending`).

- [ ] **Step 2 : Vérifier ce que contient déjà `pending`**

```bash
grep -n "pending.set" src/index.js
```

Si `pending` ne contient pas `photo`/`code` : ajouter ces champs à l'appel `pending.set` dans `proposeStructure` (à faire depuis `onPhoto` en passant `photo` et `code` via `extras`).

- [ ] **Step 3 : Test qui échoue** — dans `test/chat.test.js`, ajouter :

```javascript
test('!go capture un cas mémoire avec photo+description+code', async () => {
  const memory = require('../src/memory');
  memory.__setEmbedder((buf) => new Float32Array(512).fill(0.5));
  const saves = [];
  const orig = memory.saveCase;
  memory.saveCase = async (args) => { saves.push(args); return '2026-01-01-abcd'; };
  try {
    // ... setup handlers, simuler !go avec pending contenant photo/description/code
    // (à adapter selon la structure existante de chat.test.js)
    // Après le !go, vérifier :
    assert.strictEqual(saves.length, 1);
    assert.ok(saves[0].photo);
    assert.ok(saves[0].description);
    assert.ok(saves[0].code);
  } finally {
    memory.saveCase = orig;
  }
});

test('!note 4 met à jour la note du dernier build', async () => {
  const memory = require('../src/memory');
  const notes = [];
  const orig = memory.updateNote;
  memory.updateNote = (id, n) => { notes.push({ id, n }); };
  try {
    // ... simuler !go puis !note 4
    assert.deepStrictEqual(notes, [{ id: '<id du dernier build>', n: 4 }]);
  } finally {
    memory.updateNote = orig;
  }
});

test('!note sans build récent répond "aucune construction à noter"', async () => {
  // ... simuler !note 4 sans !go préalable
  // vérifier que le message chat contient "aucune construction"
});

test('!note avec valeur hors [1..5] rejette et prévient dans le chat', async () => {
  // ... simuler !note 9
  // vérifier message d'erreur dans le chat
});
```

Adapter les stubs `chat.test.js` existants pour les stub `bot.chat`, `pending`, etc.

- [ ] **Step 4 : RED** — commande `!note` inconnue, saveCase pas appelé.

- [ ] **Step 5 : Implémenter dans `src/chat.js`**

Dans le handler existant de `!go` :

```javascript
// juste avant builder.startBuild(...)
try {
  const buildId = await memory.saveCase({
    photo: p.photo,
    description: p.description,
    code: p.code
  });
  lastBuild.buildId = buildId;  // lastBuild est la variable de scope handler
  console.log(`[chat] cas mémoire enregistré : ${buildId}`);
} catch (err) {
  console.warn('[chat] saveCase échoué :', err.message);
}
```

Ajouter le handler `!note` :

```javascript
if (msg.startsWith('!note ')) {
  const n = parseInt(msg.slice(6).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    bot.chat(`${username} : note attendue entre 1 et 5, ex : !note 4`);
    return;
  }
  if (!lastBuild.buildId) {
    bot.chat(`${username} : aucune construction récente à noter`);
    return;
  }
  memory.updateNote(lastBuild.buildId, n);
  bot.chat(`Note enregistrée : ${n}/5, merci !`);
  return;
}
```

Dans `src/index.js`, mettre à jour l'appel `proposeStructure` dans `onPhoto` et `onSchema` pour passer `photo` et `code` :

```javascript
return proposeStructure(username, meubles, description,
  { maxSize: cfg.limits.max_size, maxBlocks: cfg.limits.max_blocks },
  { photo: buffer, code });  // ← nouveau
```

Et dans `proposeStructure` :

```javascript
pending.set(username.toLowerCase(), { blocks, size, description, ...extras });
// extras contient photo et code → dispos dans le handler !go
```

- [ ] **Step 6 : GREEN**

```bash
node --test test/chat.test.js test/memory.test.js
```
Expected: tests pass. Vérifier que tous les tests existants passent aussi :

```bash
node --test test/*.test.js
```
Expected: 362+/362+ pass (16 nouveaux + les 358 anciens).

- [ ] **Step 7 : Commit**

```bash
git add src/chat.js src/index.js test/chat.test.js
git commit -m "feat(chat): !go capture le cas mémoire, nouvelle commande !note N"
```

---

### Task 8 : Intégration `findSimilar` dans le pipeline `onPhoto`

**Files:**
- Modify: `src/index.js`
- Modify: `src/generator.js`
- Modify: `test/generator.test.js`

**Interfaces:**
- Consumes: `memory.findSimilar`
- Produces: `generateStructure` accepte `inspiration` avec cas mémoire (format étendu), l'injecte en fin de system prompt

- [ ] **Step 1 : Vérifier le format `inspiration` actuel**

```bash
grep -n "inspiration" src/generator.js
```

Le mode schemas RAG (I18) utilise déjà `inspiration` — vérifier son format actuel et l'étendre pour accepter aussi les cas mémoire. Si les deux formats coexistent (schemas + mémoire), les deux sont injectés dans le prompt (schemas d'abord, mémoire ensuite).

- [ ] **Step 2 : Test qui échoue** — ajouter à `test/generator.test.js` :

```javascript
test('generateStructure avec inspiration.memoryCases injecte les cas dans le prompt', async () => {
  const mockClient = {
    messages: {
      create: async (args) => {
        // capture le system prompt
        capturedSystem = args.system;
        return { content: [{ type: 'text', text: 'function generateStructure() { return []; } // FIN_STRUCTURE' }] };
      }
    }
  };
  let capturedSystem = '';
  await generateStructure(
    { type_batiment: 'maison', style: 'medieval', palette_blocs: { murs: 'stone_bricks' } },
    {
      mode: 'primitives',
      client: mockClient,
      inspiration: {
        memoryCases: [
          { id: 'test-1', similarity: 0.85, note: 5, description: { style: 'medieval' }, code: 'function generateStructure() { return [{x:0,y:0,z:0,block:"stone_bricks"}]; }' }
        ]
      }
    }
  );
  const systemText = Array.isArray(capturedSystem) ? capturedSystem.map((s) => s.text || s).join('\n') : capturedSystem;
  assert.match(systemText, /Cas passés similaires/);
  assert.match(systemText, /note 5\/5/);
  assert.match(systemText, /similarité 0.85/);
  assert.match(systemText, /function generateStructure/);
});
```

- [ ] **Step 3 : RED** — le prompt ne contient pas le bloc.

- [ ] **Step 4 : Étendre `formatInspiration` dans `src/generator.js`**

Si `inspiration.memoryCases` est un tableau non vide, ajouter en fin de system prompt :

```javascript
function formatMemoryCases(cases) {
  if (!cases || cases.length === 0) return '';
  const blocks = cases.map((c, i) => `--- Cas ${i + 1} (note ${c.note}/5, similarité ${c.similarity.toFixed(2)}, style ${c.description.style || 'inconnu'}) ---
Description : ${JSON.stringify(c.description).slice(0, 200)}
Code :
${c.code}`);
  return `\n\nCas passés similaires (bien notés) — inspire-toi de leur composition :\n\n${blocks.join('\n\n')}`;
}
```

Dans `generateStructure`, ajouter le résultat de `formatMemoryCases(inspiration?.memoryCases)` à la fin du system prompt.

**Rétrocompatibilité** : si `inspiration` est encore le format ancien (tableau brut de schemas), le traiter comme avant. Si c'est un objet `{ schemas, memoryCases }`, dispatcher.

Solution la plus simple : accepter les deux formats. Si `inspiration` a un champ `memoryCases`, extraire les cas ; sinon considérer que tout `inspiration` est le format schemas.

- [ ] **Step 5 : Intégrer `findSimilar` dans `src/index.js onPhoto`**

Juste avant `generateStructure` :

```javascript
const memoryCases = await memory.findSimilar(buffer, description, { n: 3, minNote: 3 })
  .catch((err) => { console.warn('[memory] findSimilar échoué :', err.message); return []; });
if (memoryCases.length > 0) {
  bot.chat(`${memoryCases.length} construction(s) passée(s) similaire(s) injectée(s) en inspiration.`);
}
const genOpts = {
  ...,
  inspiration: { memoryCases }  // (ou étendu avec schemas si onSchema)
};
```

Pour `onSchema`, combiner : `inspiration: { schemas: <analyzeSchemas>, memoryCases }`.

- [ ] **Step 6 : GREEN**

```bash
node --test test/generator.test.js test/memory.test.js test/chat.test.js
```
Expected: pass.

```bash
node --test test/*.test.js
```
Expected: 363+/363+ pass, aucune régression.

- [ ] **Step 7 : Commit**

```bash
git add src/generator.js src/index.js test/generator.test.js
git commit -m "feat(memory): findSimilar intégré dans onPhoto, few-shot dans le prompt"
```

---

### Task 9 : Warmup au démarrage + tests d'intégration finaux

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `memory.warmup`
- Produces: bot log `[memory] CLIP prêt` au démarrage (asynchrone, non-bloquant)

- [ ] **Step 1 : Ajouter `warmup` au démarrage de `src/index.js`**

Juste après la création du bot (avant l'écoute chat) :

```javascript
memory.warmup().catch((err) => console.warn('[memory] warmup échoué :', err.message));
```

Ne pas `await` — le bot doit répondre immédiatement même si CLIP prend 30s à charger. Pendant le chargement, `findSimilar` utilisera le fallback métadonnées (déjà géré).

- [ ] **Step 2 : Test manuel en jeu (checklist)**

Après avoir tout implémenté, tester en jeu :

1. Démarrer le bot → attendre le log `[memory] CLIP prêt` (30-60s au 1er lancement)
2. `!photo` (envoyer une maison bretonne via l'upload) → `!go` → vérifier log `[chat] cas mémoire enregistré : <id>`
3. `!note 4` → vérifier réponse `Note enregistrée : 4/5, merci !`
4. Vérifier fichiers `data/memoire/cases/<id>.{json,jpg,emb}` existent
5. `!photo` avec une AUTRE maison bretonne → vérifier log `1 construction(s) passée(s) similaire(s) injectée(s)`
6. Vérifier dans les logs du generator que le system prompt contient bien un bloc `Cas passés similaires`

- [ ] **Step 3 : Ajouter une entrée README de dev**

Si un `README.md` existe, ajouter une section :

```markdown
## Mémoire

Le bot mémorise chaque construction confirmée (`!go`) et le joueur peut la
noter avec `!note N` (N ∈ [1..5]). Les cas bien notés sont réutilisés en
inspiration lors des générations suivantes.

Stockage : `data/memoire/cases/`.
Effacer la mémoire : `rm -rf data/memoire/`.
```

- [ ] **Step 4 : Commit final**

```bash
git add src/index.js README.md
git commit -m "feat(memory): warmup CLIP au démarrage + doc utilisateur"
```

---

## Vérification finale

- [ ] **Suite complète**

```bash
node --test test/*.test.js
```
Expected: 363+/363+ pass (tous les tests existants + les nouveaux memory tests).

- [ ] **Vérification manuelle du disque**

Après quelques `!go` en jeu :

```bash
ls -la data/memoire/cases/ | head -20
cat data/memoire/index.json | head -30
```

Vérifier que chaque cas a bien ses 3 fichiers, que l'index est cohérent.

- [ ] **Vérification que le fallback marche**

Renommer temporairement `~/.cache/huggingface/` → relancer le bot → `!photo` doit marcher, log `[memory] CLIP indispo`, `findSimilar` utilise le fallback métadonnées.

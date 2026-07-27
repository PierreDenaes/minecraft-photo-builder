# !build via recherche web — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le joueur tape `!build <texte>` dans le chat Minecraft, le bot cherche une photo sur le web via SerpAPI, sélectionne la meilleure avec Claude Haiku vision, puis lance le pipeline photo existant (`onPhoto`).

**Architecture:** Nouveau module `src/websearch.js` (3 fonctions : refineQuery, searchImages, pickBest). Nouveau handler `!build` dans `chat.js` qui route vers `onBuild(username, userText)` dans `index.js`. `onBuild` orchestre refine → search → pick → download → délégation à `onPhoto` existant (aucune duplication du pipeline photo).

**Tech Stack:** Node.js CommonJS existant, node:test TDD, `fetch` natif Node 26, SerpAPI (HTTPS), Claude Haiku 4.5 pour refine et pick, mémoire I19 réutilisée telle quelle.

## Global Constraints

- Nouvelle variable d'environnement : `SERPAPI_KEY` (jamais commitée, lue via `process.env.SERPAPI_KEY`)
- Modèle Claude pour refine et pick : `claude-haiku-4-5-20251001` (le moins cher, suffit pour ces tâches)
- SerpAPI endpoint : `https://serpapi.com/search.json?engine=google_images&q=<query>&api_key=<key>&num=10`
- Config `web_search.n_results` défaut : 8 (nombre de candidats considérés)
- Filtre SerpAPI local : exclure les URLs qui matchent `/\.(svg|gif)(\?|$)/i`
- pickBest retourne un index 1-based (1..N) ou `null` si aucune candidate n'est utilisable
- Timeouts : refineQuery/pickBest 15s (côté Anthropic natif), searchImages/download 10-15s (AbortController)
- Messages chat en français, préfixe `${username} :` pour les erreurs adressées au joueur
- Ne rien casser des 382 tests existants sur main
- Tests node:test, TDD strict avec preuve RED avant chaque implémentation
- Aucune nouvelle dépendance npm (fetch natif Node 26)

---

### Task 1 : Squelette `websearch.js` + fixture SerpAPI + refineQuery

**Files:**
- Create: `src/websearch.js`
- Create: `test/websearch.test.js`
- Create: `test/fixtures/serpapi-response.json`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (déjà installé)
- Produces: `refineQuery(userText, { client }) → Promise<string>` — retourne une requête enrichie prête pour SerpAPI. Fallback sur `userText` original si la réponse Claude est vide.

- [ ] **Step 1 : Créer la fixture SerpAPI**

Écrire `test/fixtures/serpapi-response.json` :

```json
{
  "images_results": [
    {
      "position": 1,
      "original": "https://example.com/chateau1.jpg",
      "thumbnail": "https://example.com/thumb1.jpg",
      "title": "Château de Versailles",
      "source": "wikipedia.org",
      "original_width": 1600,
      "original_height": 900
    },
    {
      "position": 2,
      "original": "https://example.com/chateau2.png",
      "thumbnail": "https://example.com/thumb2.jpg",
      "title": "Château fort médiéval",
      "source": "flickr.com",
      "original_width": 1200,
      "original_height": 800
    },
    {
      "position": 3,
      "original": "https://example.com/dessin.svg",
      "thumbnail": "https://example.com/dessin-thumb.jpg",
      "title": "Dessin château",
      "source": "clipart.com"
    },
    {
      "position": 4,
      "original": "https://example.com/anim.gif",
      "thumbnail": "https://example.com/anim-thumb.jpg",
      "title": "GIF château animé",
      "source": "giphy.com"
    },
    {
      "position": 5,
      "original": "https://example.com/chateau5.jpg",
      "thumbnail": "https://example.com/thumb5.jpg",
      "title": "Château de Chambord",
      "source": "unsplash.com",
      "original_width": 2000,
      "original_height": 1333
    }
  ]
}
```

- [ ] **Step 2 : Test qui échoue** — écrire `test/websearch.test.js` :

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { refineQuery } = require('../src/websearch');

function fakeClient(reply) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: reply }] })
    }
  };
}

test('refineQuery retourne la reformulation Claude', async () => {
  const client = fakeClient('chateau de la belle au bois dormant Disneyland Paris, photo diurne, façade complète, sans foule');
  const out = await refineQuery('chateau de disney', { client });
  assert.match(out, /Disneyland Paris/);
  assert.match(out, /photo diurne|façade complète/);
});

test('refineQuery fallback sur userText si Claude retourne vide', async () => {
  const client = fakeClient('');
  const out = await refineQuery('chateau de disney', { client });
  assert.strictEqual(out, 'chateau de disney');
});

test('refineQuery fallback sur userText si Claude retourne 200+ caractères', async () => {
  const client = fakeClient('x'.repeat(500));
  const out = await refineQuery('chateau', { client });
  // trim à 200 caractères max ; le fallback sur userText n'est pas requis ici,
  // juste vérifier le trim (le module ne doit pas retourner 500 caractères)
  assert.ok(out.length <= 200, `sortie ${out.length} caractères, attendu ≤ 200`);
});

test('refineQuery trim la sortie (espaces, retours ligne)', async () => {
  const client = fakeClient('  chateau reformule  \n\n');
  const out = await refineQuery('chateau', { client });
  assert.strictEqual(out, 'chateau reformule');
});
```

- [ ] **Step 3 : RED — module inexistant**

Run: `node --test test/websearch.test.js`
Expected: 4 failing tests (`Cannot find module '../src/websearch'`).

- [ ] **Step 4 : Implémenter `src/websearch.js`**

```javascript
const REFINE_MODEL = 'claude-haiku-4-5-20251001';

const REFINE_SYSTEM = `Reformule la demande utilisateur en une requête Google Images optimisée pour trouver UNE photo utilisable pour reconstruire un bâtiment en Minecraft. Ajoute "photo diurne, façade complète" si absent. Désambiguïse les noms propres. Sortie : la requête reformulée, RIEN d'autre.`;

async function refineQuery(userText, { client }) {
  if (!client) throw new Error('refineQuery : client Anthropic manquant');
  try {
    const response = await client.messages.create({
      model: REFINE_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: REFINE_SYSTEM,
      messages: [{ role: 'user', content: `Reformule : "${userText}"` }]
    });
    const raw = response.content.find((b) => b.type === 'text').text.trim();
    if (!raw) return userText;
    return raw.slice(0, 200);
  } catch (err) {
    console.warn('[websearch] refineQuery échec :', err.message);
    return userText;
  }
}

module.exports = { refineQuery };
```

- [ ] **Step 5 : GREEN**

Run: `node --test test/websearch.test.js`
Expected: 4/4 pass.

- [ ] **Step 6 : Vérifier absence de régression**

Run: `node --test test/*.test.js`
Expected: 386/386 pass (382 baseline + 4 nouveaux).

- [ ] **Step 7 : Commit**

```bash
git add src/websearch.js test/websearch.test.js test/fixtures/serpapi-response.json
git commit -m "feat(websearch): refineQuery + fixture SerpAPI"
```

---

### Task 2 : `searchImages` — appel SerpAPI et parsing

**Files:**
- Modify: `src/websearch.js`
- Modify: `test/websearch.test.js`

**Interfaces:**
- Consumes: `fetch` natif Node 26, fixture `test/fixtures/serpapi-response.json`
- Produces: `searchImages(refinedQuery, { apiKey, n = 8, fetchFn }) → Promise<Array<{url, thumbnail, title, source}>>`

Le paramètre `fetchFn` (défaut `fetch` global) permet d'injecter un mock en test.

- [ ] **Step 1 : Tests qui échouent** — ajouter à `test/websearch.test.js` :

```javascript
const fs = require('node:fs');
const path = require('node:path');
const { searchImages } = require('../src/websearch');

const SERPAPI_FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/serpapi-response.json'), 'utf8'));

function fakeFetch(response, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response
  });
}

test('searchImages sans apiKey throw explicite', async () => {
  await assert.rejects(
    () => searchImages('chateau', { apiKey: undefined, fetchFn: fakeFetch({}) }),
    /apiKey manquant/
  );
});

test('searchImages parse une fixture SerpAPI', async () => {
  const results = await searchImages('chateau', { apiKey: 'test-key', fetchFn: fakeFetch(SERPAPI_FIXTURE) });
  assert.ok(Array.isArray(results));
  assert.ok(results.length >= 3, `attendu ≥ 3 résultats après filtre, obtenu ${results.length}`);
  assert.strictEqual(results[0].url, 'https://example.com/chateau1.jpg');
  assert.strictEqual(results[0].thumbnail, 'https://example.com/thumb1.jpg');
  assert.strictEqual(results[0].title, 'Château de Versailles');
  assert.strictEqual(results[0].source, 'wikipedia.org');
});

test('searchImages filtre les .svg et .gif', async () => {
  const results = await searchImages('chateau', { apiKey: 'test-key', fetchFn: fakeFetch(SERPAPI_FIXTURE) });
  const urls = results.map((r) => r.url);
  assert.ok(!urls.some((u) => u.endsWith('.svg')), `URLs SVG trouvées : ${urls}`);
  assert.ok(!urls.some((u) => u.endsWith('.gif')), `URLs GIF trouvées : ${urls}`);
});

test('searchImages respecte n=2 (top N)', async () => {
  const results = await searchImages('chateau', { apiKey: 'test-key', n: 2, fetchFn: fakeFetch(SERPAPI_FIXTURE) });
  assert.strictEqual(results.length, 2);
});

test('searchImages HTTP 429 → throw avec status', async () => {
  await assert.rejects(
    () => searchImages('chateau', { apiKey: 'test-key', fetchFn: fakeFetch({}, { status: 429 }) }),
    /HTTP 429/
  );
});

test('searchImages sans images_results retourne []', async () => {
  const results = await searchImages('chateau', { apiKey: 'test-key', fetchFn: fakeFetch({}) });
  assert.deepStrictEqual(results, []);
});
```

- [ ] **Step 2 : RED**

Run: `node --test test/websearch.test.js`
Expected: 6 failing tests (`searchImages is not a function`).

- [ ] **Step 3 : Implémenter `searchImages`** — ajouter à `src/websearch.js` :

```javascript
async function searchImages(refinedQuery, { apiKey, n = 8, fetchFn = fetch } = {}) {
  if (!apiKey) throw new Error('searchImages : apiKey manquant (SERPAPI_KEY absente)');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_images');
  url.searchParams.set('q', refinedQuery);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('num', String(Math.max(n, 10)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetchFn(url.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`SerpAPI HTTP ${response.status}`);
  const json = await response.json();
  const results = json.images_results || [];
  return results
    .filter((r) => r.original && !/\.(svg|gif)(\?|$)/i.test(r.original))
    .slice(0, n)
    .map((r) => ({
      url: r.original,
      thumbnail: r.thumbnail,
      title: r.title || '',
      source: r.source || ''
    }));
}

module.exports = { refineQuery, searchImages };
```

- [ ] **Step 4 : GREEN**

Run: `node --test test/websearch.test.js`
Expected: 10/10 pass (4 refine + 6 search).

- [ ] **Step 5 : Vérifier absence de régression**

Run: `node --test test/*.test.js`
Expected: 392/392 pass.

- [ ] **Step 6 : Commit**

```bash
git add src/websearch.js test/websearch.test.js
git commit -m "feat(websearch): searchImages via SerpAPI + filtres locaux"
```

---

### Task 3 : `pickBest` — sélection par Claude Haiku vision

**Files:**
- Modify: `src/websearch.js`
- Modify: `test/websearch.test.js`

**Interfaces:**
- Consumes: fetch natif pour télécharger les thumbnails, client Anthropic
- Produces: `pickBest(candidates, { client, fetchFn }) → Promise<number|null>` — retourne l'index 1-based (1..N) OU null si aucune candidate n'est utilisable

- [ ] **Step 1 : Tests qui échouent** — ajouter à `test/websearch.test.js` :

```javascript
const { pickBest } = require('../src/websearch');

function fakeVisionClient(reply) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: reply }] })
    }
  };
}

// fake fetch qui retourne un buffer JPEG minimal pour chaque thumbnail
function fakeThumbFetch() {
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  return async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => fakeJpeg.buffer.slice(fakeJpeg.byteOffset, fakeJpeg.byteOffset + fakeJpeg.byteLength)
  });
}

const CANDS = [
  { url: 'https://a.com/1.jpg', thumbnail: 'https://a.com/t1.jpg', title: 'a', source: 'a.com' },
  { url: 'https://a.com/2.jpg', thumbnail: 'https://a.com/t2.jpg', title: 'b', source: 'a.com' },
  { url: 'https://a.com/3.jpg', thumbnail: 'https://a.com/t3.jpg', title: 'c', source: 'a.com' }
];

test('pickBest retourne l\'index parsé (Claude répond "2")', async () => {
  const idx = await pickBest(CANDS, { client: fakeVisionClient('2'), fetchFn: fakeThumbFetch() });
  assert.strictEqual(idx, 2);
});

test('pickBest retourne null si Claude répond "aucune"', async () => {
  const idx = await pickBest(CANDS, { client: fakeVisionClient('aucune'), fetchFn: fakeThumbFetch() });
  assert.strictEqual(idx, null);
});

test('pickBest retourne null si sortie non-parsable', async () => {
  const idx = await pickBest(CANDS, { client: fakeVisionClient('bof je sais pas'), fetchFn: fakeThumbFetch() });
  assert.strictEqual(idx, null);
});

test('pickBest retourne null si index hors bornes', async () => {
  const idx = await pickBest(CANDS, { client: fakeVisionClient('99'), fetchFn: fakeThumbFetch() });
  assert.strictEqual(idx, null);
});

test('pickBest avec candidates vides retourne null', async () => {
  const idx = await pickBest([], { client: fakeVisionClient('1'), fetchFn: fakeThumbFetch() });
  assert.strictEqual(idx, null);
});
```

- [ ] **Step 2 : RED**

Run: `node --test test/websearch.test.js`
Expected: 5 failing tests (`pickBest is not a function`).

- [ ] **Step 3 : Implémenter `pickBest`** — ajouter à `src/websearch.js` :

```javascript
const PICK_MODEL = 'claude-haiku-4-5-20251001';

const PICK_SYSTEM = `Tu compares N photos candidates pour une reconstruction Minecraft. Retourne UNIQUEMENT le NUMÉRO (1..N) de la meilleure photo, OU le mot "aucune" si toutes sont inutilisables.

Bonne photo : diurne, façade complète, bâtiment centré, pas de foule, pas de texte overlay, pas de watermark, pas de dessin, pas de plan.
Inutilisable : dessin, plan technique, screenshot de jeu vidéo, photo de nuit sans détail, portrait de personne, gros plan sur un détail.`;

async function pickBest(candidates, { client, fetchFn = fetch } = {}) {
  if (!candidates || candidates.length === 0) return null;
  if (!client) throw new Error('pickBest : client Anthropic manquant');
  // télécharge chaque thumbnail en base64
  const images = [];
  for (const c of candidates) {
    try {
      const resp = await fetchFn(c.thumbnail);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      const mimeType = resp.headers.get('content-type') || 'image/jpeg';
      images.push({ base64: buf.toString('base64'), mimeType });
    } catch { /* ignore, on continue avec les autres */ }
  }
  if (images.length === 0) return null;
  const userContent = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType, data: img.base64 }
  }));
  userContent.push({ type: 'text', text: 'Choisis.' });
  const response = await client.messages.create({
    model: PICK_MODEL,
    max_tokens: 20,
    temperature: 0,
    system: PICK_SYSTEM,
    messages: [{ role: 'user', content: userContent }]
  });
  const raw = response.content.find((b) => b.type === 'text').text.trim().toLowerCase();
  if (raw === 'aucune') return null;
  const num = parseInt(raw, 10);
  if (!Number.isInteger(num) || num < 1 || num > images.length) return null;
  return num;
}

module.exports = { refineQuery, searchImages, pickBest };
```

- [ ] **Step 4 : GREEN**

Run: `node --test test/websearch.test.js`
Expected: 15/15 pass (4 refine + 6 search + 5 pick).

- [ ] **Step 5 : Vérifier absence de régression**

Run: `node --test test/*.test.js`
Expected: 397/397 pass.

- [ ] **Step 6 : Commit**

```bash
git add src/websearch.js test/websearch.test.js
git commit -m "feat(websearch): pickBest via Haiku vision"
```

---

### Task 4 : Config `web_search` + `onBuild` dans index.js

**Files:**
- Modify: `config.json`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `refineQuery`, `searchImages`, `pickBest`, `onPhoto` existant
- Produces: `onBuild(username, userText) → Promise<any>` — fonction handler exportée depuis `createBot` comme `onPhoto`, `onSchema`, etc.

- [ ] **Step 1 : Ajouter config `web_search`** — éditer `config.json` :

```json
{
  "minecraft": {
    "host": "localhost",
    "port": 25565,
    "username": "BuilderBot",
    "version": "1.20.4"
  },
  "web": {
    "port": 3000,
    "public_host": "localhost"
  },
  "limits": {
    "max_size": 96,
    "max_blocks": 500000,
    "sandbox_timeout_ms": 20000,
    "throttle_cmds_per_tick": 16,
    "diorama": {
      "size_x": 160,
      "size_z": 120,
      "max_y": 120,
      "max_blocks": 2500000
    }
  },
  "generation_mode": "code",
  "reconstruction": "inspire",
  "web_search": {
    "n_results": 8,
    "min_image_size": 400
  }
}
```

- [ ] **Step 2 : Trouver l'emplacement d'`onPhoto` dans `src/index.js`**

Run: `grep -n "async function onPhoto\|async function onSchema" src/index.js`
Expected: deux lignes du type `async function onPhoto(username, buffer, mimeType) {` et `async function onSchema(username, buffer, mimeType) {`.

- [ ] **Step 3 : Ajouter `require` et fonction `onBuild`** — dans `src/index.js`, ajouter en tête (à côté des autres requires) :

```javascript
const { refineQuery, searchImages, pickBest } = require('./websearch');
```

Puis, à côté d'`onPhoto` (juste après), ajouter :

```javascript
async function onBuild(username, userText) {
  bot.chat(`${username} : recherche "${userText}" sur le web...`);
  if (!apiClient) {
    bot.chat(`${username} : clé API Anthropic manquante — impossible de trier les résultats.`);
    return;
  }
  if (!process.env.SERPAPI_KEY) {
    bot.chat(`${username} : SERPAPI_KEY absente de l'env — configure-la et réessaie.`);
    return;
  }
  const refined = await refineQuery(userText, { client: apiClient });
  console.log(`[build] requête reformulée : "${refined}"`);
  const n = (cfg.web_search && cfg.web_search.n_results) || 8;
  const candidates = await searchImages(refined, { apiKey: process.env.SERPAPI_KEY, n });
  if (candidates.length === 0) {
    bot.chat(`${username} : aucune image trouvée pour "${userText}". Réessaie avec une description plus précise.`);
    return;
  }
  const bestIdx = await pickBest(candidates, { client: apiClient });
  if (bestIdx === null) {
    bot.chat(`${username} : aucune photo utilisable parmi les ${candidates.length} résultats. Réessaie plus précis, ex: "chateau disneyland paris facade jour".`);
    return;
  }
  const chosen = candidates[bestIdx - 1];
  bot.chat(`Photo trouvée : ${chosen.url}`);
  bot.chat('Analyse en cours (~1 min)...');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(chosen.url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`téléchargement image HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return onPhoto(username, buffer, mimeType);
}
```

Ensuite, chercher la ligne qui exporte les handlers (typiquement à la fin de `createBot` ou dans le `return`) et y ajouter `onBuild`. Exemple probable — si le fichier retourne un objet ou passe les handlers au webserver :

```javascript
const app = createWebServer({ onPhoto, onDiorama, onModel, onPortrait, onSchema });
```

Cette ligne reste inchangée (onBuild ne passe pas par le webserver, uniquement par le chat).

Mais dans le handler chat, il faudra passer `onBuild` — cherche où le chat handler est créé/passé :

Run: `grep -n "installChatHandler\|onChat\|handleChat" src/index.js`

Selon le pattern trouvé, expose `onBuild` de la même manière que les autres handlers.

- [ ] **Step 4 : Vérifier que rien n'est cassé**

Run: `node --test test/*.test.js`
Expected: 397/397 pass (onBuild n'est pas testé unitairement à ce stade, testable via chat.test.js en Task 5).

- [ ] **Step 5 : Commit**

```bash
git add config.json src/index.js
git commit -m "feat(build): onBuild orchestre refine/search/pick puis délègue à onPhoto"
```

---

### Task 5 : Handler `!build` dans `chat.js` + tests

**Files:**
- Modify: `src/chat.js`
- Modify: `test/chat.test.js`

**Interfaces:**
- Consumes: `onBuild(username, userText)` injecté depuis `index.js` (via l'objet handlers passé à `installChatHandler`)
- Produces: comportement de la commande `!build <texte>` observable via chat

- [ ] **Step 1 : Trouver le point d'injection des handlers dans chat.js**

Run: `grep -n "onPhoto\|onSchema\|installChatHandler\|createChatHandler\|module.exports" src/chat.js`

Le fichier expose probablement une fonction (`installChatHandler` ou similaire) qui prend `{onPhoto, onSchema, ...}` en argument. On ajoute `onBuild` à ce contrat.

- [ ] **Step 2 : Tests qui échouent** — ajouter à `test/chat.test.js` :

Repérer d'abord le pattern setup existant :

Run: `grep -n "function setup\|function createHandler\|const handle" test/chat.test.js | head -5`

Sur le pattern existant (probablement une fonction `setup({...})` qui construit un fake bot + un handler), ajouter :

```javascript
test('!build sans texte répond message d\'erreur', () => {
  const buildCalls = [];
  const { bot, handle } = setup({ onBuild: async (u, t) => { buildCalls.push({ u, t }); } });
  handle('Steve', '!build');
  assert.strictEqual(buildCalls.length, 0);
  assert.ok(bot.sent.some((m) => m.includes('!build attend une description')), `messages envoyés : ${bot.sent}`);
});

test('!build <texte> appelle onBuild avec le texte extrait', async () => {
  const buildCalls = [];
  const { handle } = setup({ onBuild: async (u, t) => { buildCalls.push({ u, t }); } });
  handle('Steve', '!build chateau de disney');
  // laisser la microtask se résoudre
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(buildCalls.length, 1);
  assert.strictEqual(buildCalls[0].u, 'Steve');
  assert.strictEqual(buildCalls[0].t, 'chateau de disney');
});

test('!build trim les espaces autour du texte', async () => {
  const buildCalls = [];
  const { handle } = setup({ onBuild: async (u, t) => { buildCalls.push({ u, t }); } });
  handle('Steve', '!build   tour eiffel   ');
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(buildCalls[0].t, 'tour eiffel');
});

test('!build sans onBuild injecté répond message d\'erreur', () => {
  const { bot, handle } = setup({});  // pas d'onBuild
  handle('Steve', '!build chateau');
  assert.ok(bot.sent.some((m) => m.toLowerCase().includes('indisponible') || m.toLowerCase().includes('build')), `messages : ${bot.sent}`);
});
```

Note : si le pattern `setup` de `chat.test.js` ne supporte pas encore `onBuild` en override, adapte-le (rétrocompatible : `setup({onBuild})` optionnel).

- [ ] **Step 3 : RED**

Run: `node --test test/chat.test.js`
Expected: 4 failing tests (handler `!build` inexistant, messages introuvables).

- [ ] **Step 4 : Implémenter handler `!build` dans `src/chat.js`**

Ajouter au constructeur/setup du handler (là où `onPhoto` etc. sont acceptés) le paramètre `onBuild`. Puis dans le corps du handler, avant les autres commandes ou après `!photo` :

```javascript
if (cmd.startsWith('!build ') || cmd === '!build') {
  const userText = cmd === '!build' ? '' : cmd.slice(7).trim();
  if (!userText) {
    bot.chat(`${username} : !build attend une description, ex: !build chateau de disney`);
    return;
  }
  if (!onBuild) {
    bot.chat(`${username} : commande !build indisponible dans cet environnement`);
    return;
  }
  Promise.resolve(onBuild(username, userText)).catch((err) => {
    bot.chat(`${username} : erreur !build : ${err.message}`);
  });
  return;
}
```

Le fire-and-forget suit le pattern déjà utilisé pour `saveCase` à `!go` (I19) : ne bloque pas le chat handler synchrone.

- [ ] **Step 5 : GREEN**

Run: `node --test test/chat.test.js`
Expected: tous les tests passent (les 4 nouveaux + les existants).

- [ ] **Step 6 : Vérifier absence de régression complète**

Run: `node --test test/*.test.js`
Expected: 401/401 pass (397 + 4 nouveaux tests chat.test.js).

- [ ] **Step 7 : Commit**

```bash
git add src/chat.js test/chat.test.js
git commit -m "feat(chat): commande !build <texte> câblée à onBuild"
```

---

### Task 6 : Câbler `onBuild` du côté `index.js` vers `chat.js` + README

**Files:**
- Modify: `src/index.js` (juste le câblage handlers → chat, pas la logique)
- Modify: `README.md`

**Interfaces:**
- Consumes: `onBuild` (défini Task 4), pattern de câblage handlers (défini Task 5)
- Produces: `!build` fonctionne end-to-end en jeu

- [ ] **Step 1 : Trouver la ligne qui installe le handler chat dans `src/index.js`**

Run: `grep -n "installChatHandler\|createChatHandler\|require('./chat')" src/index.js`

Le pattern probable : quelque chose comme `const handle = installChatHandler(bot, { onPhoto, onSchema, ... })` ou `bot.on('chat', createChatHandler({onPhoto, ...}))`.

- [ ] **Step 2 : Ajouter `onBuild` à la liste des handlers passés**

Modifier la ligne trouvée pour inclure `onBuild` — exemple si le pattern est un objet :

```javascript
const handle = installChatHandler(bot, {
  onPhoto,
  onSchema,
  onDiorama,
  onPortrait,
  onModel,
  onBuild        // ← nouveau
});
```

Adapter exactement au pattern existant sans réordonner les autres champs.

- [ ] **Step 3 : Ajouter section "!build" au README.md**

Trouver la section existante sur les commandes (probablement listée) et ajouter :

```markdown
### `!build <texte>` — construire depuis une description

Le bot cherche une photo sur le web via SerpAPI, sélectionne la meilleure avec
Claude Haiku vision, puis lance le pipeline photo. Exemples :

```
!build chateau de disney
!build tour eiffel
!build villa moderne avec piscine
```

Requiert la variable d'environnement `SERPAPI_KEY` (250 requêtes gratuites par
mois sur serpapi.com).

Une fois la photo trouvée, le bot annonce son URL dans le chat et lance
l'analyse. Le reste du flux est identique à `!photo` : proposition, `!go` /
`!cancel`, puis `!note N` pour enrichir la mémoire.
```

Si la section "Mémoire" ajoutée en I19 est présente, placer `!build` juste avant elle pour groupe de commandes cohérent. Sinon placer à la fin de la section commandes existante.

- [ ] **Step 4 : Vérifier absence de régression**

Run: `node --test test/*.test.js`
Expected: 401/401 pass (aucun test nouveau ici, câblage pur).

- [ ] **Step 5 : Test manuel en jeu (checklist, différée à l'humain)**

Après merge et setup `export SERPAPI_KEY=...` :

1. Démarrer le bot, se connecter au serveur Minecraft
2. Taper `!build chateau de disney` dans le chat
3. Vérifier les messages successifs :
   - `Steve : recherche "chateau de disney" sur le web...`
   - `Photo trouvée : https://...`
   - `Analyse en cours (~1 min)...`
4. Vérifier que la construction est proposée avec !go / !cancel
5. Taper `!go`, vérifier la construction
6. Taper `!note 4`, vérifier `Note enregistrée : 4/5, merci !`
7. Vérifier que `data/memoire/cases/` contient un nouveau cas
8. Cas d'échec à tester : `!build xyzzy` (rien ne matchera) → message d'erreur

- [ ] **Step 6 : Commit final**

```bash
git add src/index.js README.md
git commit -m "feat(build): câblage onBuild au chat handler + doc"
```

---

## Vérification finale

- [ ] **Suite complète**

Run: `node --test test/*.test.js`
Expected: 401/401 pass.

- [ ] **Vérification manuelle SerpAPI**

Sans démarrer le bot, tester un appel isolé :

```bash
node -e "require('./src/websearch').searchImages('chateau de versailles', { apiKey: process.env.SERPAPI_KEY, n: 3 }).then(r => console.log(JSON.stringify(r, null, 2)))"
```

Expected: 3 objets `{url, thumbnail, title, source}` avec des URLs réelles. Utile pour valider que la clé fonctionne avant de tester en jeu.

- [ ] **Vérification du câblage handler**

```bash
grep -n "onBuild" src/index.js src/chat.js
```

Expected : `onBuild` apparaît au moins :
- 1 fois dans `src/index.js` (définition de la fonction)
- 1 fois dans `src/index.js` (passage aux handlers chat)
- 2 fois dans `src/chat.js` (déclaration paramètre + usage dans `!build`)

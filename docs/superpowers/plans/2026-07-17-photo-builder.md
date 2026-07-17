# Minecraft Photo Builder — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bot Mineflayer qui construit en jeu une structure interprétée à partir d'une photo envoyée par le joueur.

**Architecture:** Pipeline : upload photo (Express) → analyse vision (Claude) → génération de code JS sandboxé (`node:vm`) produisant une liste de blocs → validation + fusion en commandes `/fill` → exécution throttlée en jeu avec confirmation et undo. Modules découplés, testables sans le jeu.

**Tech Stack:** Node.js 26 (CommonJS), mineflayer, @anthropic-ai/sdk, express, multer, node:test, Docker (`itzg/minecraft-server`, Paper 1.20.4).

## Global Constraints

- Minecraft 1.20.4, mode créatif, bot OP, serveur Paper via Docker, `online-mode=false`
- Limites : structure max 64×64×64, max 100 000 blocs, sandbox timeout 5 000 ms, image max 5 Mo (JPEG/PNG/WebP)
- `ANTHROPIC_API_KEY` uniquement via variable d'environnement (jamais dans le code ni config.json)
- Modèle vision et génération : `claude-sonnet-4-6`
- `/fill` vanilla : max 32 768 blocs par commande → toujours découper par couches
- Throttle : max 10 commandes/tick (on envoie 2 commandes / 50 ms)
- Tests : `node:test` natif, commande `npm test`
- Messages joueur en français dans le chat du jeu

---

### Task 1 : Scaffold du projet + serveur Minecraft Docker

**Files:**
- Create: `package.json`, `config.json`, `.gitignore`, `docker-compose.yml`

**Interfaces:**
- Produces: `config.json` (lu par toutes les tâches suivantes via `require('../config.json')`), scripts npm `server`, `server:reset`, `test`

- [ ] **Step 1 : Créer package.json**

```json
{
  "name": "minecraft-photo-builder",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/",
    "server": "docker compose up -d && docker compose logs -f",
    "server:reset": "docker compose down && rm -rf mc-data && docker compose up -d"
  },
  "dependencies": {
    "mineflayer": "^4.20.0",
    "@anthropic-ai/sdk": "latest",
    "express": "^4.19.0",
    "multer": "^1.4.5-lts.1"
  }
}
```

- [ ] **Step 2 : Créer config.json et .gitignore**

`config.json` :
```json
{
  "minecraft": { "host": "localhost", "port": 25565, "username": "BuilderBot", "version": "1.20.4" },
  "web": { "port": 3000, "public_host": "localhost" },
  "limits": { "max_size": 64, "max_blocks": 100000, "sandbox_timeout_ms": 5000 },
  "generation_mode": "code"
}
```

`.gitignore` :
```
node_modules/
mc-data/
*.log
```

- [ ] **Step 3 : Créer docker-compose.yml**

```yaml
services:
  minecraft:
    image: itzg/minecraft-server
    environment:
      EULA: "TRUE"
      TYPE: PAPER
      VERSION: "1.20.4"
      MODE: creative
      LEVEL_TYPE: FLAT
      ONLINE_MODE: "FALSE"
      OPS: BuilderBot
      DIFFICULTY: peaceful
      SPAWN_PROTECTION: "0"
      ALLOW_FLIGHT: "TRUE"
      MEMORY: 2G
    ports:
      - "25565:25565"
    volumes:
      - ./mc-data:/data
```

- [ ] **Step 4 : Installer les dépendances et démarrer le serveur**

Run: `npm install && docker compose up -d`
Puis: `docker compose logs -f` (Ctrl-C pour quitter les logs)
Expected: log contenant `Done (…s)! For help, type "help"` (premier démarrage : 1-3 min)

- [ ] **Step 5 : Commit**

```bash
git add package.json package-lock.json config.json .gitignore docker-compose.yml
git commit -m "feat: scaffold projet + serveur Paper 1.20.4 via Docker"
```

---

### Task 2 : Bot Mineflayer minimal

**Files:**
- Create: `src/index.js`

**Interfaces:**
- Consumes: `config.json`
- Produces: `createBot(config)` exporté depuis `src/index.js` — retourne l'instance mineflayer ; le point d'entrée (`node src/index.js`) connecte le bot et log les messages chat

- [ ] **Step 1 : Écrire src/index.js**

```javascript
const mineflayer = require('mineflayer');
const config = require('../config.json');

function createBot(cfg) {
  const bot = mineflayer.createBot({
    host: cfg.minecraft.host,
    port: cfg.minecraft.port,
    username: cfg.minecraft.username,
    version: cfg.minecraft.version,
    auth: 'offline'
  });
  bot.on('spawn', () => console.log('[bot] connecté et apparu en jeu'));
  bot.on('kicked', (reason) => console.error('[bot] kick:', reason));
  bot.on('error', (err) => console.error('[bot] erreur:', err.message));
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
    if (message === '!ping') bot.chat('pong');
  });
  return bot;
}

if (require.main === module) createBot(config);
module.exports = { createBot };
```

- [ ] **Step 2 : Vérifier la connexion**

Run: `npm start`
Expected: `[bot] connecté et apparu en jeu`. Ensuite, rejoindre le serveur avec un client Minecraft 1.20.4 (connexion `localhost`), taper `!ping` dans le chat → le bot répond `pong`. Si pas de client disponible : vérifier dans `docker compose logs` la ligne `BuilderBot joined the game`.

- [ ] **Step 3 : Commit**

```bash
git add src/index.js
git commit -m "feat: bot mineflayer minimal connecté au chat"
```

---

### Task 3 : Liste blanche de blocs + validation de structure

**Files:**
- Create: `data/valid_blocks.json`, `src/optimizer.js`
- Test: `test/optimizer.validate.test.js`

**Interfaces:**
- Produces: `validateStructure(blocks, { maxSize, maxBlocks, validBlocks }) → { ok: boolean, errors: string[] }` — `blocks` = `[{x, y, z, block}]`, coordonnées relatives entières ≥ 0

- [ ] **Step 1 : Créer data/valid_blocks.json**

```json
["air","stone","cobblestone","stone_bricks","mossy_stone_bricks","smooth_stone","andesite","polished_andesite","diorite","granite","deepslate","cobbled_deepslate","bricks","mud_bricks","sandstone","smooth_sandstone","red_sandstone","dirt","grass_block","sand","gravel","clay","terracotta","white_terracotta","red_terracotta","orange_terracotta","yellow_terracotta","brown_terracotta","oak_planks","spruce_planks","birch_planks","dark_oak_planks","acacia_planks","jungle_planks","mangrove_planks","cherry_planks","oak_log","spruce_log","birch_log","dark_oak_log","acacia_log","jungle_log","stripped_oak_log","stripped_spruce_log","stripped_dark_oak_log","oak_stairs","spruce_stairs","birch_stairs","dark_oak_stairs","stone_brick_stairs","cobblestone_stairs","brick_stairs","sandstone_stairs","oak_slab","spruce_slab","dark_oak_slab","stone_slab","stone_brick_slab","cobblestone_slab","oak_fence","spruce_fence","dark_oak_fence","oak_door","spruce_door","dark_oak_door","iron_door","oak_trapdoor","spruce_trapdoor","glass","glass_pane","white_stained_glass","gray_stained_glass","light_blue_stained_glass","brown_stained_glass","white_wool","gray_wool","light_gray_wool","black_wool","red_wool","blue_wool","green_wool","yellow_wool","white_concrete","gray_concrete","light_gray_concrete","black_concrete","red_concrete","blue_concrete","green_concrete","yellow_concrete","orange_concrete","brown_concrete","quartz_block","smooth_quartz","quartz_stairs","quartz_slab","iron_block","iron_bars","chain","lantern","torch","wall_torch","campfire","ladder","glowstone","sea_lantern","bookshelf","crafting_table","furnace","chest","barrel","smoker","flower_pot","hay_block","pumpkin","jack_o_lantern","snow_block","ice","packed_ice","water","lava","oak_leaves","spruce_leaves","dark_oak_leaves","azalea_leaves"]
```

- [ ] **Step 2 : Écrire le test qui échoue**

`test/optimizer.validate.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { validateStructure } = require('../src/optimizer');

const limits = { maxSize: 64, maxBlocks: 100000, validBlocks: ['stone', 'oak_planks', 'air'] };

test('accepte une structure valide', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 1, y: 0, z: 0, block: 'oak_planks' }
  ];
  assert.deepStrictEqual(validateStructure(blocks, limits), { ok: true, errors: [] });
});

test('rejette une structure vide', () => {
  const r = validateStructure([], limits);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /vide/);
});

test('rejette un bloc inconnu', () => {
  const r = validateStructure([{ x: 0, y: 0, z: 0, block: 'kryptonite' }], limits);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(' '), /kryptonite/);
});

test('rejette des coordonnées non entières ou négatives', () => {
  assert.strictEqual(validateStructure([{ x: 0.5, y: 0, z: 0, block: 'stone' }], limits).ok, false);
  assert.strictEqual(validateStructure([{ x: -1, y: 0, z: 0, block: 'stone' }], limits).ok, false);
});

test('rejette une structure trop grande', () => {
  const r = validateStructure([
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 64, y: 0, z: 0, block: 'stone' }
  ], limits);
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(' '), /64/);
});

test('rejette trop de blocs', () => {
  const r = validateStructure(
    [{ x: 0, y: 0, z: 0, block: 'stone' }, { x: 1, y: 0, z: 0, block: 'stone' }],
    { ...limits, maxBlocks: 1 }
  );
  assert.strictEqual(r.ok, false);
});
```

- [ ] **Step 3 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/optimizer'`

- [ ] **Step 4 : Implémenter validateStructure dans src/optimizer.js**

```javascript
function validateStructure(blocks, { maxSize, maxBlocks, validBlocks }) {
  const errors = [];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { ok: false, errors: ['structure vide ou invalide'] };
  }
  if (blocks.length > maxBlocks) {
    errors.push(`trop de blocs : ${blocks.length} > ${maxBlocks}`);
  }
  const valid = new Set(validBlocks);
  const badNames = new Set();
  let badCoord = false;
  let min = { x: Infinity, y: Infinity, z: Infinity };
  let max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of blocks) {
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isInteger(b[axis]) || b[axis] < 0) badCoord = true;
      min[axis] = Math.min(min[axis], b[axis]);
      max[axis] = Math.max(max[axis], b[axis]);
    }
    if (typeof b.block !== 'string' || !valid.has(b.block)) badNames.add(String(b.block));
  }
  if (badCoord) errors.push('coordonnées invalides : entiers >= 0 requis');
  if (badNames.size > 0) errors.push(`blocs inconnus : ${[...badNames].join(', ')}`);
  for (const axis of ['x', 'y', 'z']) {
    const span = max[axis] - min[axis] + 1;
    if (span > maxSize) errors.push(`dimension ${axis} trop grande : ${span} > ${maxSize} (max 64)`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateStructure };
```

- [ ] **Step 5 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 6 : Commit**

```bash
git add data/valid_blocks.json src/optimizer.js test/optimizer.validate.test.js
git commit -m "feat: validation de structure (liste blanche, limites)"
```

---

### Task 4 : Fusion greedy en commandes /fill

**Files:**
- Modify: `src/optimizer.js`
- Test: `test/optimizer.commands.test.js`

**Interfaces:**
- Consumes: format `[{x, y, z, block}]`
- Produces: `optimizeToCommands(blocks, origin) → string[]` — `origin` = `{x, y, z}` absolu ; commandes `/fill x1 y z1 x2 y z2 bloc` (fusion des runs contigus sur l'axe x, par ligne y/z) et `/setblock` pour les blocs isolés ; doublons de coordonnées dédupliqués (le dernier gagne) ; les blocs `air` de la structure sont ignorés

- [ ] **Step 1 : Écrire le test qui échoue**

`test/optimizer.commands.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { optimizeToCommands } = require('../src/optimizer');

const origin = { x: 100, y: -60, z: 200 };

test('fusionne un run contigu sur x en /fill', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 1, y: 0, z: 0, block: 'stone' },
    { x: 2, y: 0, z: 0, block: 'stone' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/fill 100 -60 200 102 -60 200 stone'
  ]);
});

test('bloc isolé en /setblock', () => {
  assert.deepStrictEqual(
    optimizeToCommands([{ x: 5, y: 2, z: 3, block: 'oak_planks' }], origin),
    ['/setblock 105 -58 203 oak_planks']
  );
});

test('coupe le run quand le bloc change', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 1, y: 0, z: 0, block: 'stone' },
    { x: 2, y: 0, z: 0, block: 'oak_planks' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/fill 100 -60 200 101 -60 200 stone',
    '/setblock 102 -60 200 oak_planks'
  ]);
});

test('trie par couches y croissant', () => {
  const blocks = [
    { x: 0, y: 5, z: 0, block: 'stone' },
    { x: 0, y: 0, z: 0, block: 'stone' }
  ];
  const cmds = optimizeToCommands(blocks, origin);
  assert.match(cmds[0], /-60/);
  assert.match(cmds[1], /-55/);
});

test('déduplique une coordonnée en gardant le dernier bloc', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 0, y: 0, z: 0, block: 'oak_planks' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/setblock 100 -60 200 oak_planks'
  ]);
});

test('ignore les blocs air', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'air' },
    { x: 1, y: 0, z: 0, block: 'stone' }
  ];
  assert.deepStrictEqual(optimizeToCommands(blocks, origin), [
    '/setblock 101 -60 200 stone'
  ]);
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `optimizeToCommands is not a function`

- [ ] **Step 3 : Implémenter optimizeToCommands dans src/optimizer.js**

Ajouter avant `module.exports` :
```javascript
function optimizeToCommands(blocks, origin) {
  const byCoord = new Map();
  for (const b of blocks) {
    if (b.block === 'air') { byCoord.delete(`${b.x},${b.y},${b.z}`); continue; }
    byCoord.set(`${b.x},${b.y},${b.z}`, b);
  }
  const rows = new Map();
  for (const b of byCoord.values()) {
    const key = `${b.y}|${b.z}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(b);
  }
  const keys = [...rows.keys()].sort((a, b) => {
    const [ya, za] = a.split('|').map(Number);
    const [yb, zb] = b.split('|').map(Number);
    return ya - yb || za - zb;
  });
  const commands = [];
  for (const key of keys) {
    const row = rows.get(key).sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (
        j + 1 < row.length &&
        row[j + 1].x === row[j].x + 1 &&
        row[j + 1].block === row[i].block
      ) j++;
      const a = row[i];
      const b = row[j];
      const ax = origin.x + a.x, ay = origin.y + a.y, az = origin.z + a.z;
      if (i === j) {
        commands.push(`/setblock ${ax} ${ay} ${az} ${a.block}`);
      } else {
        commands.push(`/fill ${ax} ${ay} ${az} ${origin.x + b.x} ${ay} ${az} ${a.block}`);
      }
      i = j + 1;
    }
  }
  return commands;
}
```
Et mettre à jour l'export : `module.exports = { validateStructure, optimizeToCommands };`

- [ ] **Step 4 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 5 : Commit**

```bash
git add src/optimizer.js test/optimizer.commands.test.js
git commit -m "feat: fusion greedy des blocs en commandes /fill"
```

---

### Task 5 : Client LLM avec retry + module vision

**Files:**
- Create: `src/llm.js`, `src/vision.js`
- Test: `test/vision.test.js`
- Create: `test/fixtures/description_maison.json`

**Interfaces:**
- Produces (`src/llm.js`) : `createClient() → Anthropic` (lit `ANTHROPIC_API_KEY` de l'env) ; `withRetry(fn, { retries = 3, baseDelayMs = 1000 }) → Promise` (backoff exponentiel)
- Produces (`src/vision.js`) : `analyzeImage(imageBase64, mimeType, { client, maxSize }) → Promise<description>` — retourne l'objet description (schéma CLAUDE.md) ou `{ erreur: string }` ; lance une `Error` si la réponse n'est pas du JSON parsable. `client` injecté pour les tests.

- [ ] **Step 1 : Écrire src/llm.js**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY manquante dans l\'environnement');
  }
  return new Anthropic();
}

async function withRetry(fn, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        console.warn(`[llm] échec (tentative ${attempt + 1}), retry dans ${delay} ms :`, err.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function stripCodeFences(text) {
  return text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
}

module.exports = { createClient, withRetry, stripCodeFences };
```

- [ ] **Step 2 : Créer la fixture test/fixtures/description_maison.json**

```json
{
  "type_batiment": "maison à colombages",
  "style": "médiéval européen",
  "dimensions_estimees": { "largeur": 12, "profondeur": 9, "hauteur": 10 },
  "etages": 2,
  "toit": { "forme": "deux pans", "materiau_suggere": "dark_oak_stairs" },
  "elements": ["cheminée à droite", "fenêtres à croisillons", "porte centrale"],
  "palette_blocs": {
    "murs": "white_concrete",
    "colombages": "dark_oak_log",
    "toit": "dark_oak_stairs",
    "fondation": "cobblestone"
  }
}
```

- [ ] **Step 3 : Écrire le test qui échoue**

`test/vision.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeImage } = require('../src/vision');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/description_maison.json'), 'utf8')
);

function fakeClient(responseText) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: responseText }] }) } };
}

test('parse une réponse JSON valide', async () => {
  const client = fakeClient(JSON.stringify(fixture));
  const result = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.strictEqual(result.type_batiment, 'maison à colombages');
  assert.strictEqual(result.dimensions_estimees.largeur, 12);
});

test('tolère les balises markdown autour du JSON', async () => {
  const client = fakeClient('```json\n' + JSON.stringify(fixture) + '\n```');
  const result = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.strictEqual(result.etages, 2);
});

test('propage une erreur métier {erreur}', async () => {
  const client = fakeClient('{"erreur": "aucun bâtiment identifiable"}');
  const result = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(result.erreur, /bâtiment/);
});

test('lance une Error si réponse non-JSON', async () => {
  const client = fakeClient('Voici une belle maison !');
  await assert.rejects(
    () => analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 }),
    /JSON/
  );
});
```

- [ ] **Step 4 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/vision'`

- [ ] **Step 5 : Implémenter src/vision.js**

```javascript
const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

function systemPrompt(maxSize) {
  return `Tu analyses une photo de bâtiment pour un constructeur Minecraft (version 1.20).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown.

Schéma attendu :
{
  "type_batiment": "...",
  "style": "...",
  "dimensions_estimees": { "largeur": N, "profondeur": N, "hauteur": N },
  "etages": N,
  "toit": { "forme": "...", "materiau_suggere": "bloc_minecraft" },
  "elements": ["..."],
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc" }
}

Règles :
- Tous les blocs doivent être des noms Minecraft 1.20 valides (snake_case, sans préfixe minecraft:)
- Dimensions maximales : ${maxSize} sur chaque axe
- Mappe les couleurs/matériaux réels vers les blocs les plus proches
- Si l'image ne contient aucun bâtiment identifiable, réponds : {"erreur": "raison courte"}`;
}

async function analyzeImage(imageBase64, mimeType, { client, maxSize = 64 } = {}) {
  const c = client || createClient();
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt(maxSize),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: 'Analyse ce bâtiment et réponds avec le JSON demandé.' }
        ]
      }]
    })
  );
  const text = stripCodeFences(response.content.find((b) => b.type === 'text').text);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`réponse vision non-JSON : ${text.slice(0, 200)}`);
  }
  console.log('[vision] description :', JSON.stringify(parsed));
  return parsed;
}

module.exports = { analyzeImage };
```

- [ ] **Step 6 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 7 : Commit**

```bash
git add src/llm.js src/vision.js test/vision.test.js test/fixtures/description_maison.json
git commit -m "feat: module vision Claude avec retry et parsing JSON strict"
```

---

### Task 6 : Générateur de structure (LLM + sandbox vm)

**Files:**
- Create: `src/generator.js`
- Test: `test/generator.test.js`

**Interfaces:**
- Consumes: `withRetry`, `stripCodeFences`, `createClient` de `src/llm.js` ; description JSON de `analyzeImage`
- Produces: `runStructureCode(code, timeoutMs) → [{x,y,z,block}]` (sandbox `node:vm`, contexte vide, lance `Error` si timeout ou retour invalide) ; `generateStructure(description, { client, timeoutMs }) → Promise<[{x,y,z,block}]>` (appel LLM + sandbox)

- [ ] **Step 1 : Écrire le test qui échoue**

`test/generator.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { runStructureCode, generateStructure } = require('../src/generator');

test('exécute un code valide et retourne les blocs', () => {
  const code = `function generateStructure() {
    const blocks = [];
    for (let x = 0; x < 3; x++) blocks.push({ x, y: 0, z: 0, block: 'stone' });
    return blocks;
  }`;
  const blocks = runStructureCode(code, 5000);
  assert.strictEqual(blocks.length, 3);
  assert.deepStrictEqual(blocks[0], { x: 0, y: 0, z: 0, block: 'stone' });
});

test('rejette un code qui ne retourne pas un tableau', () => {
  assert.throws(() => runStructureCode('function generateStructure() { return 42; }', 5000), /tableau/);
});

test('tue une boucle infinie par timeout', () => {
  assert.throws(
    () => runStructureCode('function generateStructure() { while (true) {} }', 200),
    /Script execution timed out/
  );
});

test('le sandbox n\'a pas accès à require ni process', () => {
  assert.throws(() => runStructureCode('function generateStructure() { return require("fs"); }', 5000));
  assert.throws(() => runStructureCode('function generateStructure() { return process.env; }', 5000));
});

test('generateStructure appelle le LLM puis exécute le code', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: code }] }) } };
  const blocks = await generateStructure({ type_batiment: 'test' }, { client, timeoutMs: 5000 });
  assert.strictEqual(blocks.length, 1);
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/generator'`

- [ ] **Step 3 : Implémenter src/generator.js**

```javascript
const vm = require('node:vm');
const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Tu écris du code JavaScript pur pour générer une structure Minecraft.
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown.

Contraintes strictes :
- Définis une fonction generateStructure() qui retourne un tableau [{x, y, z, block}]
- Coordonnées entières >= 0 ; x = largeur, y = hauteur (0 = sol), z = profondeur
- Reste dans les dimensions estimées de la description
- Utilise uniquement les blocs de palette_blocs, plus "air" pour les ouvertures (portes, fenêtres) et "glass_pane" pour les vitres
- Code pur : pas de require, pas d'accès réseau/fichiers, pas de récursion infinie
- Construis paramétriquement : murs pleins, ouvertures, toit selon la forme décrite
- Les intérieurs sont creux (air)`;

function runStructureCode(code, timeoutMs) {
  const context = vm.createContext(Object.create(null));
  const script = new vm.Script(`${code}\ngenerateStructure();`);
  const result = script.runInContext(context, { timeout: timeoutMs });
  if (!Array.isArray(result)) {
    throw new Error('generateStructure() doit retourner un tableau de blocs');
  }
  return result;
}

async function generateStructure(description, { client, timeoutMs = 5000 } = {}) {
  const c = client || createClient();
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Description du bâtiment :\n${JSON.stringify(description, null, 2)}\n\nÉcris generateStructure().`
      }]
    })
  );
  const code = stripCodeFences(response.content.find((b) => b.type === 'text').text);
  console.log('[generator] code généré :\n', code);
  return runStructureCode(code, timeoutMs);
}

module.exports = { runStructureCode, generateStructure };
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 5 : Commit**

```bash
git add src/generator.js test/generator.test.js
git commit -m "feat: génération de structure par code LLM sandboxé (node:vm)"
```

---

### Task 7 : Serveur web d'upload

**Files:**
- Create: `src/webserver.js`
- Test: `test/webserver.test.js`

**Interfaces:**
- Consumes: rien (module autonome)
- Produces: `createWebServer({ onPhoto }) → express.Application` — `GET /upload/:username` sert un formulaire HTML ; `POST /build-from-photo` (multipart : champ `username`, fichier `photo`) appelle `await onPhoto(username, buffer, mimeType)` et répond `{ ok: true, message }` ou `{ ok: false, error }` (HTTP 400/500). Limite 5 Mo, types `image/jpeg`, `image/png`, `image/webp`.

- [ ] **Step 1 : Écrire le test qui échoue**

`test/webserver.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { createWebServer } = require('../src/webserver');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function post(port, formData) {
  return fetch(`http://localhost:${port}/build-from-photo`, { method: 'POST', body: formData });
}

test('GET /upload/:username sert le formulaire', async () => {
  const app = createWebServer({ onPhoto: async () => {} });
  const server = await listen(app);
  const res = await fetch(`http://localhost:${server.address().port}/upload/Steve`);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(html, /Steve/);
  assert.match(html, /build-from-photo/);
  server.close();
});

test('POST avec image valide appelle onPhoto', async () => {
  let received = null;
  const app = createWebServer({
    onPhoto: async (username, buffer, mimeType) => { received = { username, size: buffer.length, mimeType }; return 'analyse lancée'; }
  });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('photo', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'maison.jpg');
  const res = await post(server.address().port, fd);
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(received, { username: 'Steve', size: 3, mimeType: 'image/jpeg' });
  server.close();
});

test('POST sans fichier répond 400', async () => {
  const app = createWebServer({ onPhoto: async () => {} });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 400);
  server.close();
});

test('POST avec type non-image répond 400', async () => {
  const app = createWebServer({ onPhoto: async () => {} });
  const server = await listen(app);
  const fd = new FormData();
  fd.append('username', 'Steve');
  fd.append('photo', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  const res = await post(server.address().port, fd);
  assert.strictEqual(res.status, 400);
  server.close();
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/webserver'`

- [ ] **Step 3 : Implémenter src/webserver.js**

```javascript
const express = require('express');
const multer = require('multer');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function createWebServer({ onPhoto }) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED.has(file.mimetype)) cb(null, true);
      else cb(new Error('format non supporté (JPEG, PNG, WebP uniquement)'));
    }
  });

  app.get('/upload/:username', (req, res) => {
    const username = String(req.params.username).replace(/[^A-Za-z0-9_]/g, '');
    res.send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Photo Builder</title></head>
<body>
  <h1>Envoyer une photo pour ${username}</h1>
  <form method="post" action="/build-from-photo" enctype="multipart/form-data">
    <input type="hidden" name="username" value="${username}">
    <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required>
    <button type="submit">Construire !</button>
  </form>
</body></html>`);
  });

  app.post('/build-from-photo', (req, res) => {
    upload.single('photo')(req, res, async (err) => {
      if (err) return res.status(400).json({ ok: false, error: err.message });
      if (!req.file) return res.status(400).json({ ok: false, error: 'aucune image reçue' });
      if (!req.body.username) return res.status(400).json({ ok: false, error: 'pseudo manquant' });
      try {
        console.log(`[web] image reçue de ${req.body.username} (${req.file.size} octets, ${req.file.mimetype})`);
        const message = await onPhoto(req.body.username, req.file.buffer, req.file.mimetype);
        res.json({ ok: true, message: message || 'photo reçue, analyse en cours' });
      } catch (e) {
        console.error('[web] erreur pipeline :', e.message);
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  });

  return app;
}

module.exports = { createWebServer };
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 5 : Commit**

```bash
git add src/webserver.js test/webserver.test.js
git commit -m "feat: serveur Express d'upload de photo"
```

---

### Task 8 : Builder (placement, aplanissement, throttle, undo)

**Files:**
- Create: `src/builder.js`
- Test: `test/builder.test.js`

**Interfaces:**
- Consumes: `optimizeToCommands(blocks, origin)` de `src/optimizer.js`
- Produces: classe `Builder` :
  - `new Builder(bot, { maxBlocks })` — `bot` ne doit exposer que `chat(cmd)` et `blockAt(vec)` (facile à mocker)
  - `computeOrigin(playerPos, yaw, size) → {x, y, z}` — coin min de la structure, 5 blocs devant le joueur (direction cardinale dominante du regard), `y` = `floor(playerPos.y)`
  - `flattenCommands(origin, size) → string[]` — air sur l'emprise + 1 de marge, par couches y (jamais plus de 32 768 blocs par `/fill`), et sol en dirt à `origin.y - 1`
  - `startBuild(blocks, origin, size) → { total }` — snapshot pour undo, puis enfile flatten + commandes structure, envoi 2 commandes / 50 ms
  - `undo() → boolean` — restaure le snapshot (false si aucun)
  - `status() → { active, done, total }`

- [ ] **Step 1 : Écrire le test qui échoue**

`test/builder.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { Builder } = require('../src/builder');

function fakeBot() {
  const sent = [];
  return {
    sent,
    chat: (cmd) => sent.push(cmd),
    blockAt: () => ({ name: 'air' })
  };
}

test('computeOrigin place la structure 5 blocs devant le joueur (regard -z)', () => {
  const b = new Builder(fakeBot(), { maxBlocks: 100000 });
  // yaw 0 en mineflayer = regard vers -z (nord)... vérifié en jeu Task 10
  const origin = b.computeOrigin({ x: 0.5, y: -60, z: 0.5 }, 0, { x: 4, y: 3, z: 4 });
  assert.deepStrictEqual(origin, { x: -2, y: -60, z: -9 });
});

test('flattenCommands couvre emprise + 1 par couches y', () => {
  const b = new Builder(fakeBot(), { maxBlocks: 100000 });
  const cmds = b.flattenCommands({ x: 10, y: -60, z: 10 }, { x: 4, y: 3, z: 4 });
  assert.strictEqual(cmds.length, 4); // 3 couches d'air + 1 sol
  assert.strictEqual(cmds[0], '/fill 9 -61 9 14 -61 14 dirt');
  assert.strictEqual(cmds[1], '/fill 9 -60 9 14 -60 14 air');
  assert.strictEqual(cmds[3], '/fill 9 -58 9 14 -58 14 air');
});

test('startBuild envoie les commandes de manière throttlée', async () => {
  const bot = fakeBot();
  const b = new Builder(bot, { maxBlocks: 100000 });
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 0, y: 1, z: 0, block: 'stone' },
    { x: 0, y: 2, z: 0, block: 'stone' }
  ];
  const { total } = b.startBuild(blocks, { x: 0, y: -60, z: 0 }, { x: 1, y: 3, z: 1 });
  assert.ok(total > 3); // flatten + 3 setblock
  await new Promise((r) => setTimeout(r, 50 * total));
  assert.strictEqual(bot.sent.length, total);
  assert.strictEqual(b.status().active, false);
  assert.strictEqual(b.status().done, total);
});

test('undo restaure le snapshot', async () => {
  const bot = fakeBot();
  bot.blockAt = () => ({ name: 'grass_block' });
  const b = new Builder(bot, { maxBlocks: 100000 });
  b.startBuild([{ x: 0, y: 0, z: 0, block: 'stone' }], { x: 0, y: -60, z: 0 }, { x: 1, y: 1, z: 1 });
  await new Promise((r) => setTimeout(r, 500));
  bot.sent.length = 0;
  assert.strictEqual(b.undo(), true);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(bot.sent.some((c) => c.includes('grass_block')));
  assert.strictEqual(b.undo(), false);
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/builder'`

- [ ] **Step 3 : Implémenter src/builder.js**

```javascript
const { optimizeToCommands } = require('./optimizer');

const TICK_MS = 50;
const CMDS_PER_TICK = 2;

class Builder {
  constructor(bot, { maxBlocks }) {
    this.bot = bot;
    this.maxBlocks = maxBlocks;
    this.queue = [];
    this.timer = null;
    this.snapshot = null;
    this.progress = { active: false, done: 0, total: 0 };
  }

  computeOrigin(playerPos, yaw, size) {
    // Direction cardinale dominante du regard (convention mineflayer : x = -sin(yaw), z = -cos(yaw))
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const px = Math.floor(playerPos.x);
    const pz = Math.floor(playerPos.z);
    const y = Math.floor(playerPos.y);
    if (Math.abs(dx) > Math.abs(dz)) {
      const sign = Math.sign(dx);
      return {
        x: sign > 0 ? px + 5 : px - 5 - (size.x - 1),
        y,
        z: pz - Math.floor(size.z / 2)
      };
    }
    const sign = Math.sign(dz) || -1;
    return {
      x: px - Math.floor(size.x / 2),
      y,
      z: sign > 0 ? pz + 5 : pz - 5 - (size.z - 1)
    };
  }

  flattenCommands(origin, size) {
    const x1 = origin.x - 1, x2 = origin.x + size.x;
    const z1 = origin.z - 1, z2 = origin.z + size.z;
    const cmds = [`/fill ${x1} ${origin.y - 1} ${z1} ${x2} ${origin.y - 1} ${z2} dirt`];
    for (let y = origin.y; y < origin.y + size.y; y++) {
      cmds.push(`/fill ${x1} ${y} ${z1} ${x2} ${y} ${z2} air`);
    }
    return cmds;
  }

  takeSnapshot(origin, size) {
    const volume = (size.x + 2) * (size.y + 1) * (size.z + 2);
    if (volume > this.maxBlocks) return null;
    const saved = [];
    for (let x = origin.x - 1; x <= origin.x + size.x; x++) {
      for (let y = origin.y - 1; y < origin.y + size.y; y++) {
        for (let z = origin.z - 1; z <= origin.z + size.z; z++) {
          const block = this.bot.blockAt({ x, y, z });
          saved.push({ x: x - origin.x + 1, y: y - origin.y + 1, z: z - origin.z + 1, block: block ? block.name : 'air' });
        }
      }
    }
    return { origin: { x: origin.x - 1, y: origin.y - 1, z: origin.z - 1 }, blocks: saved };
  }

  startBuild(blocks, origin, size) {
    this.snapshot = this.takeSnapshot(origin, size);
    const cmds = [
      ...this.flattenCommands(origin, size),
      ...optimizeToCommands(blocks, origin)
    ];
    this.enqueue(cmds);
    return { total: cmds.length };
  }

  undo() {
    if (!this.snapshot) return false;
    // Restaurer : d'abord tout vider (air) par couches, puis reposer les blocs sauvegardés non-air
    const cmds = [
      ...this.flattenCommandsFromSnapshot(),
      ...optimizeToCommands(this.snapshot.blocks, this.snapshot.origin)
    ];
    this.snapshot = null;
    this.enqueue(cmds);
    return true;
  }

  flattenCommandsFromSnapshot() {
    const s = this.snapshot;
    let max = { x: 0, y: 0, z: 0 };
    for (const b of s.blocks) {
      max = { x: Math.max(max.x, b.x), y: Math.max(max.y, b.y), z: Math.max(max.z, b.z) };
    }
    const cmds = [];
    for (let y = 0; y <= max.y; y++) {
      cmds.push(`/fill ${s.origin.x} ${s.origin.y + y} ${s.origin.z} ${s.origin.x + max.x} ${s.origin.y + y} ${s.origin.z + max.z} air`);
    }
    return cmds;
  }

  enqueue(cmds) {
    this.queue.push(...cmds);
    this.progress = { active: true, done: 0, total: this.queue.length };
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (let i = 0; i < CMDS_PER_TICK && this.queue.length > 0; i++) {
        this.bot.chat(this.queue.shift());
        this.progress.done++;
      }
      if (this.queue.length === 0) {
        clearInterval(this.timer);
        this.timer = null;
        this.progress.active = false;
      }
    }, TICK_MS);
  }

  status() {
    return { ...this.progress };
  }

  estimateSeconds(totalCommands) {
    return Math.ceil((totalCommands / CMDS_PER_TICK) * TICK_MS / 1000);
  }
}

module.exports = { Builder };
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 5 : Commit**

```bash
git add src/builder.js test/builder.test.js
git commit -m "feat: builder throttlé avec aplanissement et undo"
```

---

### Task 9 : Commandes chat + machine à états

**Files:**
- Create: `src/chat.js`
- Test: `test/chat.test.js`

**Interfaces:**
- Consumes: `Builder` (`startBuild`, `undo`, `status`, `computeOrigin`, `estimateSeconds`)
- Produces: `createChatHandler({ bot, builder, config, pending }) → (username, message) => void` — `pending` = `Map<username, { blocks, size, description }>` partagée avec le pipeline (Task 10). Commandes : `!photo`, `!go`, `!cancel`, `!undo`, `!status`.

- [ ] **Step 1 : Écrire le test qui échoue**

`test/chat.test.js` :
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { createChatHandler } = require('../src/chat');

function setup() {
  const messages = [];
  const bot = {
    username: 'BuilderBot',
    chat: (m) => messages.push(m),
    players: { Steve: { entity: { position: { x: 0.5, y: -60, z: 0.5 }, yaw: 0 } } }
  };
  const calls = [];
  const builder = {
    computeOrigin: () => ({ x: 0, y: -60, z: -9 }),
    startBuild: (...args) => { calls.push(['startBuild', args]); return { total: 42 }; },
    undo: () => { calls.push(['undo']); return true; },
    status: () => ({ active: true, done: 10, total: 42 }),
    estimateSeconds: () => 2
  };
  const pending = new Map();
  const config = { web: { port: 3000, public_host: 'localhost' }, limits: { max_size: 64, max_blocks: 100000 } };
  const handle = createChatHandler({ bot, builder, config, pending });
  return { messages, calls, pending, handle };
}

test('!photo donne le lien d\'upload', () => {
  const { messages, handle } = setup();
  handle('Steve', '!photo');
  assert.match(messages[0], /http:\/\/localhost:3000\/upload\/Steve/);
});

test('!go sans proposition en attente informe le joueur', () => {
  const { messages, calls, handle } = setup();
  handle('Steve', '!go');
  assert.strictEqual(calls.length, 0);
  assert.match(messages[0], /aucune/i);
});

test('!go avec proposition lance la construction', () => {
  const { calls, pending, handle, messages } = setup();
  pending.set('Steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  assert.strictEqual(calls[0][0], 'startBuild');
  assert.strictEqual(pending.has('Steve'), false);
  assert.match(messages.join(' '), /construction/i);
});

test('!cancel vide la proposition', () => {
  const { pending, handle, messages } = setup();
  pending.set('Steve', { blocks: [], size: {}, description: {} });
  handle('Steve', '!cancel');
  assert.strictEqual(pending.has('Steve'), false);
  assert.match(messages[0], /annul/i);
});

test('!undo appelle builder.undo', () => {
  const { calls, handle } = setup();
  handle('Steve', '!undo');
  assert.deepStrictEqual(calls[0], ['undo']);
});

test('!status affiche la progression', () => {
  const { messages, handle } = setup();
  handle('Steve', '!status');
  assert.match(messages[0], /10\/42/);
});

test('ignore ses propres messages', () => {
  const { messages, handle } = setup();
  handle('BuilderBot', '!photo');
  assert.strictEqual(messages.length, 0);
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/chat'`

- [ ] **Step 3 : Implémenter src/chat.js**

```javascript
function createChatHandler({ bot, builder, config, pending }) {
  return function handle(username, message) {
    if (username === bot.username) return;
    const cmd = message.trim();

    if (cmd === '!photo') {
      bot.chat(`${username} : envoie ta photo ici → http://${config.web.public_host}:${config.web.port}/upload/${username}`);
      return;
    }

    if (cmd === '!go') {
      const p = pending.get(username);
      if (!p) { bot.chat(`${username} : aucune proposition en attente. Envoie une photo avec !photo`); return; }
      const player = bot.players[username];
      if (!player || !player.entity) { bot.chat(`${username} : je ne te vois pas en jeu.`); return; }
      const origin = builder.computeOrigin(player.entity.position, player.entity.yaw, p.size);
      const { total } = builder.startBuild(p.blocks, origin, p.size);
      pending.delete(username);
      bot.chat(`Construction de ${p.description.type_batiment} lancée (~${builder.estimateSeconds(total)} s, ${total} commandes). !status pour suivre, !undo pour annuler.`);
      return;
    }

    if (cmd === '!cancel') {
      if (pending.delete(username)) bot.chat(`${username} : proposition annulée.`);
      else bot.chat(`${username} : rien à annuler.`);
      return;
    }

    if (cmd === '!undo') {
      if (builder.undo()) bot.chat('Restauration de la zone en cours...');
      else bot.chat('Aucune construction à annuler.');
      return;
    }

    if (cmd === '!status') {
      const s = builder.status();
      if (s.total === 0) bot.chat('Aucune construction en cours.');
      else bot.chat(`Avancement : ${s.done}/${s.total} commandes${s.active ? '' : ' (terminé)'}.`);
      return;
    }
  };
}

module.exports = { createChatHandler };
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npm test`
Expected: tous les tests PASS

- [ ] **Step 5 : Commit**

```bash
git add src/chat.js test/chat.test.js
git commit -m "feat: commandes chat joueur (!photo !go !cancel !undo !status)"
```

---

### Task 10 : Câblage du pipeline dans index.js

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: tous les modules précédents
- Produces: application complète — `npm start` lance bot + serveur web ; le pipeline photo → vision → génération → validation → proposition alimente la Map `pending`

- [ ] **Step 1 : Réécrire src/index.js**

```javascript
const fs = require('node:fs');
const path = require('node:path');
const mineflayer = require('mineflayer');
const config = require('../config.json');
const { analyzeImage } = require('./vision');
const { generateStructure } = require('./generator');
const { validateStructure } = require('./optimizer');
const { Builder } = require('./builder');
const { createChatHandler } = require('./chat');
const { createWebServer } = require('./webserver');

const validBlocks = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/valid_blocks.json'), 'utf8')
);

function structureSize(blocks) {
  const max = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    max.x = Math.max(max.x, b.x);
    max.y = Math.max(max.y, b.y);
    max.z = Math.max(max.z, b.z);
  }
  return { x: max.x + 1, y: max.y + 1, z: max.z + 1 };
}

function createBot(cfg) {
  const bot = mineflayer.createBot({
    host: cfg.minecraft.host,
    port: cfg.minecraft.port,
    username: cfg.minecraft.username,
    version: cfg.minecraft.version,
    auth: 'offline'
  });

  const pending = new Map();
  const builder = new Builder(bot, { maxBlocks: cfg.limits.max_blocks });
  const handleChat = createChatHandler({ bot, builder, config: cfg, pending });

  bot.on('spawn', () => console.log('[bot] connecté et apparu en jeu'));
  bot.on('kicked', (reason) => console.error('[bot] kick:', reason));
  bot.on('error', (err) => console.error('[bot] erreur:', err.message));
  bot.on('chat', handleChat);

  async function onPhoto(username, buffer, mimeType) {
    bot.chat(`Photo reçue de ${username}, analyse en cours...`);
    const description = await analyzeImage(buffer.toString('base64'), mimeType, {
      maxSize: cfg.limits.max_size
    });
    if (description.erreur) {
      bot.chat(`${username} : analyse impossible — ${description.erreur}`);
      return `erreur : ${description.erreur}`;
    }
    const blocks = await generateStructure(description, {
      timeoutMs: cfg.limits.sandbox_timeout_ms
    });
    const check = validateStructure(blocks, {
      maxSize: cfg.limits.max_size,
      maxBlocks: cfg.limits.max_blocks,
      validBlocks
    });
    if (!check.ok) {
      bot.chat(`${username} : structure invalide — ${check.errors[0]}`);
      throw new Error(check.errors.join(' ; '));
    }
    const size = structureSize(blocks);
    pending.set(username, { blocks, size, description });
    bot.chat(`Construction de ${description.type_batiment} (${size.x}x${size.z}x${size.y}, ${blocks.length} blocs) devant toi. Tape !go pour confirmer, !cancel pour annuler.`);
    return 'proposition envoyée en jeu, tape !go dans le chat Minecraft';
  }

  const app = createWebServer({ onPhoto });
  app.listen(cfg.web.port, () =>
    console.log(`[web] upload sur http://${cfg.web.public_host}:${cfg.web.port}/upload/<pseudo>`)
  );

  return bot;
}

if (require.main === module) createBot(config);
module.exports = { createBot };
```

- [ ] **Step 2 : Vérifier que tout tourne**

Run: `npm test` → tous PASS.
Run: `npm start` → `[bot] connecté et apparu en jeu` et `[web] upload sur http://localhost:3000/upload/<pseudo>`.
Ouvrir `http://localhost:3000/upload/Steve` dans un navigateur → le formulaire s'affiche.

- [ ] **Step 3 : Vérifier la convention yaw en jeu**

Rejoindre le serveur en client 1.20.4, se placer face au nord (F3 : facing north), taper dans le chat une commande de test via le bot (envoyer une photo ou temporairement appeler `builder.computeOrigin`). Si la structure apparaît derrière le joueur au lieu de devant, inverser les signes de `dx`/`dz` dans `computeOrigin` (src/builder.js) et ajuster le test de la Task 8 en conséquence.

- [ ] **Step 4 : Commit**

```bash
git add src/index.js
git commit -m "feat: câblage complet du pipeline photo vers construction"
```

---

### Task 11 : Test de bout en bout

**Files:**
- Create: `test/fixtures/README.md` (consignes photos de test)

**Interfaces:**
- Consumes: application complète, clé API réelle

- [ ] **Step 1 : Préparer les fixtures**

Créer `test/fixtures/README.md` :
```markdown
# Photos de test

Déposer ici 3-4 photos variées (non commitées si volumineuses) :
- une maison simple (pavillon)
- une maison à colombages ou bâtiment ancien
- une tour ou un bâtiment haut
- une photo SANS bâtiment (paysage) pour tester le cas {"erreur"}
```
Déposer les photos correspondantes dans `test/fixtures/`.

- [ ] **Step 2 : Lancer le test complet**

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # créer la clé sur console.anthropic.com
docker compose up -d
npm start
```
Rejoindre le serveur en client Minecraft 1.20.4. Dérouler :
1. `!photo` → cliquer le lien, uploader la photo de maison simple
2. Attendre la proposition dans le chat (~15-30 s)
3. `!go` → la zone s'aplanit puis la structure se construit par couches
4. `!status` pendant la construction → progression affichée
5. `!undo` → la zone est restaurée
6. Uploader la photo sans bâtiment → message d'erreur clair dans le chat
7. `!cancel` après une proposition → proposition annulée

Expected: les 7 étapes se déroulent sans kick du bot ni erreur non gérée ; chaque étape loggée en console (image, JSON vision, code généré, commandes).

- [ ] **Step 3 : Itérer sur les prompts**

Si les structures sont incohérentes (murs troués, toit flottant) : ajouter un exemple few-shot dans `SYSTEM_PROMPT` de `src/generator.js` (description fixture → code d'une petite maison valide). Re-tester avec les mêmes photos pour comparer.

- [ ] **Step 4 : Commit final**

```bash
git add test/fixtures/README.md
git commit -m "test: fixtures et protocole de bout en bout"
```

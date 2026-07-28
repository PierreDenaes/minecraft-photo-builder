const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const memory = require('../src/memory');

// ---- Suite principale : chemins reroutés vers un répertoire temporaire ----
// Évite d'écraser data/memoire/ de production à chaque npm test

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-i19-'));
  memory.__setRootDir(tmpDir);
});

after(() => {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  // Remettre le chemin prod pour ne pas polluer d'autres suites si rechargé
  memory.__setRootDir(path.join(__dirname, '..', 'data', 'memoire'));
});

test('__ensureDirs crée cases/ dans le répertoire rerouté', () => {
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

// Helpers for saveCase tests
const { rmSync } = require('node:fs');

function resetMemoryDir() {
  // Nettoyer uniquement le répertoire temporaire rerouté (jamais le prod)
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

// ---- IMPORTANT 4 : test minSimilarity=0.5 avec embeddings vraiment différents ----

test('findSimilar avec minSimilarity=0.99 exclut un cas visuellement très différent', async () => {
  resetMemoryDir();
  // Embedder déterministe basé sur la somme des bytes du buffer :
  // deux buffers très différents donnent des vecteurs très différents
  const variableEmbedder = (buf) => {
    const seed = buf.reduce((s, b) => s + b, 0);
    const out = new Float32Array(512);
    for (let i = 0; i < 512; i++) out[i] = Math.sin(seed + i) * 0.5 + 0.5;
    // normaliser
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < 512; i++) out[i] /= norm;
    return out;
  };
  memory.__setEmbedder(variableEmbedder);

  // Cas 1 : buffer "clair" (valeurs 50)
  const bufClair = Buffer.from(new Uint8Array(100).fill(50));
  const thumbClair = await require('sharp')(bufClair, { raw: { width: 10, height: 10, channels: 1 } })
    .jpeg({ quality: 80 }).toBuffer();
  const id1 = await memory.saveCase({
    photo: thumbClair,
    description: { style: 'moderne', type_batiment: 'villa' },
    code: 'A'
  });
  memory.updateNote(id1, 5);

  // Cas 2 : buffer très différent "sombre" (valeurs 200)
  const bufSombre = Buffer.from(new Uint8Array(100).fill(200));
  const thumbSombre = await require('sharp')(bufSombre, { raw: { width: 10, height: 10, channels: 1 } })
    .jpeg({ quality: 80 }).toBuffer();
  const id2 = await memory.saveCase({
    photo: thumbSombre,
    description: { style: 'moderne', type_batiment: 'villa' },
    code: 'B'
  });
  memory.updateNote(id2, 5);

  // Requête avec un buffer proche de bufClair : seul id1 devrait passer minSimilarity=0.99
  const res = await memory.findSimilar(thumbClair, { style: 'moderne', type_batiment: 'villa' }, { minSimilarity: 0.99, minNote: 3 });
  assert.ok(res.every((r) => r.id !== id2), `id2 (buffer très différent) ne devrait pas passer minSimilarity=0.99`);
  assert.ok(res.length >= 1, 'id1 (même buffer) devrait être retourné');
  assert.strictEqual(res[0].id, id1);
});

// === Corrections audit 27/07 (CORRECTIONS-memory.md) ===

test('saveCase SANS CLIP : ne throw plus, écrit .json/.jpg/index mais PAS .emb', async () => {
  resetMemoryDir();
  memory.__setEmbedder(null); // cas de prod macOS : warmup désactivé
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  let id;
  await assert.doesNotReject(async () => {
    id = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa_contemporaine' }, code: 'x' });
  });
  assert.ok(fs.existsSync(path.join(memory.CASES_DIR, `${id}.json`)), '.json attendu');
  assert.ok(fs.existsSync(path.join(memory.CASES_DIR, `${id}.jpg`)), '.jpg attendu');
  assert.ok(!fs.existsSync(path.join(memory.CASES_DIR, `${id}.emb`)), '.emb NE doit PAS exister sans CLIP');
  const index = JSON.parse(fs.readFileSync(memory.INDEX_PATH, 'utf8'));
  assert.ok(index.some((e) => e.id === id), 'cas ajouté à l\'index');
});

test('updateNote retourne true en succès, false si cas absent ou note invalide', async () => {
  resetMemoryDir();
  memory.__setEmbedder(null);
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'medieval', type_batiment: 'maison' }, code: '' });
  assert.strictEqual(memory.updateNote(id, 4), true, 'succès → true');
  assert.strictEqual(memory.updateNote('2020-01-01-ffff', 3), false, 'cas absent → false');
  assert.strictEqual(memory.updateNote(id, 9), false, 'note hors [1..5] → false');
});

test('updateNote sans index.json ne crashe pas (garde fs.existsSync)', async () => {
  resetMemoryDir();
  memory.__setEmbedder(null);
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa' }, code: '' });
  fs.rmSync(memory.INDEX_PATH); // index disparu (corruption, nettoyage manuel)
  assert.doesNotThrow(() => memory.updateNote(id, 5));
  assert.strictEqual(memory.updateNote(id, 5), true);
});

test('findSimilar fallback : match de type assoupli (inclusion croisée)', async () => {
  resetMemoryDir();
  memory.__setEmbedder(null);
  const photo = fs.readFileSync(path.join(__dirname, 'fixtures/memory/photo-small.jpg'));
  const id = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa_contemporaine_piscine' }, code: 'v1' });
  memory.updateNote(id, 4);
  // requête "villa" ⊂ "villa_contemporaine_piscine" → doit matcher
  const found = await memory.findSimilar(photo, { style: 'moderne', type_batiment: 'villa' });
  assert.strictEqual(found.length, 1, 'inclusion croisée villa ⊂ villa_contemporaine_piscine');
  assert.strictEqual(found[0].id, id);
  // style différent → pas de match (style reste strict)
  const other = await memory.findSimilar(photo, { style: 'medieval', type_batiment: 'villa' });
  assert.strictEqual(other.length, 0, 'le style reste strict');
});

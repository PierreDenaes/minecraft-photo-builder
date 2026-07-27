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

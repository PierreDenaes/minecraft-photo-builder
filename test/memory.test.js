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

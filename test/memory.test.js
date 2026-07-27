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

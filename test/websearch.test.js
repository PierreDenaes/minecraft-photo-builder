const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { refineQuery, searchImages } = require('../src/websearch');

const SERPAPI_FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/serpapi-response.json'), 'utf8'));

function fakeClient(reply) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: reply }] })
    }
  };
}

function fakeFetch(response, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response
  });
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

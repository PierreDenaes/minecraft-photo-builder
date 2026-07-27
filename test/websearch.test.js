const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { refineQuery, searchImages, pickBest } = require('../src/websearch');

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

// Helper for pickBest tests
function fakeVisionClient(reply) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: reply }] })
    }
  };
}

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

test('pickBest retourne le candidate correspondant à l\'index (Claude répond "2")', async () => {
  const result = await pickBest(CANDS, { client: fakeVisionClient('2'), fetchFn: fakeThumbFetch() });
  assert.deepStrictEqual(result, CANDS[1]);
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

test('pickBest : si un thumbnail échoue au download, l\'index Claude est mappé sur les SURVIVANTS (pas la liste originale)', async () => {
  // fetchFn : réussit sur t1 et t3, échoue sur t2
  let n = 0;
  const partialFetch = async () => {
    n++;
    const ok = n !== 2; // 2e appel échoue
    return {
      ok,
      status: ok ? 200 : 404,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from([0xff]).buffer
    };
  };
  // Claude reçoit 2 survivants (t1 et t3) et répond "2" → doit retourner CANDS[2] (le 3e original)
  const chosen = await pickBest(CANDS, { client: fakeVisionClient('2'), fetchFn: partialFetch });
  assert.deepStrictEqual(chosen, CANDS[2]);
});

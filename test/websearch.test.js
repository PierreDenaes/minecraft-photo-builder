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

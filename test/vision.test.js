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

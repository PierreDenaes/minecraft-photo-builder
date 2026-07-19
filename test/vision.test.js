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

test('injecte la liste des blocs autorisés dans le prompt système', async () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/description_maison.json'), 'utf8'));
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fx) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64, validBlocks: ['stone', 'brick_slab'] });
  assert.match(captured.system, /brick_slab/);
});

test('le prompt système demande zone_batiment en pourcentages', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(captured.system, /zone_batiment/);
  assert.match(captured.system, /pourcentage/i);
});

test('le prompt système demande la description de l\'environnement', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(captured.system, /environnement/);
  assert.match(captured.system, /ambiance/);
  assert.match(captured.system, /types_arbres/);
});

test('le prompt système demande le cadrage sujet_seul/scene_complete', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(captured.system, /cadrage/);
  assert.match(captured.system, /sujet_seul/);
});

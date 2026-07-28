const { test } = require('node:test');
const assert = require('node:assert');
const config = require('../config.json');

// Centralisation des identifiants de modèles (SYNTHESE-AUDIT.md, chantier transverse) :
// chaque module doit résoudre son modèle depuis config.json (repli sur le défaut).
// On capture le modèle réellement envoyé à l'API via un faux client.

function capture() {
  const c = { params: null };
  c.client = { messages: { create: async (p) => { c.params = p; return { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }; } } };
  return c;
}

test('config.json expose une section models complète (7 clés)', () => {
  assert.ok(config.models, 'section models présente');
  for (const k of ['generator', 'vision_analyse', 'vision_critique', 'decorateur_roles', 'palette_themes', 'websearch_refine', 'websearch_pick']) {
    assert.strictEqual(typeof config.models[k], 'string', `models.${k} défini`);
  }
});

test('vision.analyzeImage utilise config.models.vision_analyse', async () => {
  const { analyzeImage } = require('../src/vision');
  const cap = capture();
  await analyzeImage('AAAA', 'image/jpeg', { client: cap.client, maxSize: 64 });
  assert.strictEqual(cap.params.model, config.models.vision_analyse);
});

test('vision.compareToPhoto utilise config.models.vision_critique', async () => {
  const { compareToPhoto } = require('../src/vision');
  const cap = capture();
  cap.client.messages.create = async (p) => { cap.params = p; return { content: [{ type: 'text', text: '{"success":true}' }], stop_reason: 'end_turn' }; };
  await compareToPhoto('UEhP', 'image/jpeg', 'UkVO', { client: cap.client });
  assert.strictEqual(cap.params.model, config.models.vision_critique);
});

test('websearch.refineQuery utilise config.models.websearch_refine', async () => {
  const { refineQuery } = require('../src/websearch');
  const cap = capture();
  cap.client.messages.create = async (p) => { cap.params = p; return { content: [{ type: 'text', text: 'tour eiffel paris' }] }; };
  await refineQuery('tour eiffel', { client: cap.client });
  assert.strictEqual(cap.params.model, config.models.websearch_refine);
});

test('generator : env GENERATOR_MODEL a priorité sur config', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/generator.js'), 'utf8');
  assert.match(src, /process\.env\.GENERATOR_MODEL/, 'priorité env conservée');
  assert.match(src, /MODELS\.generator/, 'lecture depuis config.models');
});

test('les 5 modules lisent config.json (pas d\'identifiant en dur restant)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const attendus = {
    'generator.js': 'MODELS.generator',
    'vision.js': 'MODELS.vision_analyse',
    'decorator.js': 'MODELS.decorateur_roles',
    'palette.js': 'MODELS.palette_themes',
    'websearch.js': 'MODELS.websearch_refine'
  };
  for (const [f, needle] of Object.entries(attendus)) {
    const src = fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    assert.match(src, /require\('\.\.\/config\.json'\)\.models/, `${f} charge config.models`);
    assert.ok(src.includes(needle), `${f} lit ${needle}`);
  }
});

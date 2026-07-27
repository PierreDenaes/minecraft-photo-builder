const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeImage } = require('../src/vision');

const sysText = (s) => (typeof s === 'string' ? s : s.map((b) => b.text).join('\n'));

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

test('réponse non-JSON → {erreur} (chemin d\'erreur propre d\'index.js, plus de throw)', async () => {
  const client = fakeClient('Voici une belle maison !');
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(r.erreur, /non exploitable/);
});

test('injecte la liste des blocs autorisés dans le prompt système', async () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/description_maison.json'), 'utf8'));
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fx) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64, validBlocks: ['stone', 'brick_slab'] });
  assert.match(sysText(captured.system), /brick_slab/);
});

test('le prompt système demande zone_batiment en pourcentages', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(sysText(captured.system), /zone_batiment/);
  assert.match(sysText(captured.system), /pourcentage/i);
});

test('le prompt système demande la description de l\'environnement', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(sysText(captured.system), /environnement/);
  assert.match(sysText(captured.system), /ambiance/);
  assert.match(sysText(captured.system), /types_arbres/);
});

test('le prompt système demande le cadrage sujet_seul/scene_complete', async () => {
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: JSON.stringify(fixture) }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(sysText(captured.system), /cadrage/);
  assert.match(sysText(captured.system), /sujet_seul/);
});

const { compareToPhoto } = require('../src/vision');

test('compareToPhoto envoie les deux images et retourne les écarts formatés', async () => {
  let captured = null;
  const critJson = JSON.stringify({
    success: false, confidence: 0.9,
    missing: ['cheminée sur pignon droit -> ajouter cheminee({x:12, ...})'],
    excess: ['4ème baie -> retirer baie à x=18'],
    defects: []
  });
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: critJson }] }; } } };
  const critique = await compareToPhoto('UEhPVE8=', 'image/jpeg', 'UkVORFU=', { client });
  const images = captured.messages[0].content.filter((b) => b.type === 'image');
  assert.strictEqual(images.length, 2);
  assert.strictEqual(images[0].source.data, 'UEhPVE8=');
  assert.strictEqual(images[1].source.data, 'UkVORFU=');
  assert.ok(critique.includes('ÉLÉMENTS MANQUANTS'), `attendu section MANQUANTS dans : ${critique}`);
  assert.ok(critique.includes('cheminée'), `attendu 'cheminée' dans : ${critique}`);
  assert.ok(critique.includes('ÉLÉMENTS EN TROP'), `attendu section EN TROP dans : ${critique}`);
});

test('compareToPhoto : panne API → null sans lever', async () => {
  const client = { messages: { create: async () => { throw new Error('panne'); } } };
  assert.strictEqual(await compareToPhoto('a', 'image/png', 'b', { client }), null);
});

test('compareToPhoto : success=true → null (rendu jugé fidèle)', async () => {
  const okJson = JSON.stringify({ success: true, confidence: 0.95, missing: [], excess: [], defects: [] });
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: okJson }] }) } };
  assert.strictEqual(await compareToPhoto('a', 'image/png', 'b', { client }), null);
});

test('compareToPhoto : JSON non-parsable → null (dégradation silencieuse)', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: 'bof je ne sais pas' }] }) } };
  assert.strictEqual(await compareToPhoto('a', 'image/png', 'b', { client }), null);
});

test('compareToPhoto : JSON avec code fences (```json ... ```) est parsé', async () => {
  const critJson = '```json\n' + JSON.stringify({ success: false, confidence: 0.7, missing: ['x'], excess: [], defects: [] }) + '\n```';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: critJson }] }) } };
  const critique = await compareToPhoto('a', 'image/png', 'b', { client });
  assert.ok(critique && critique.includes('ÉLÉMENTS MANQUANTS'));
});

test('compareToPhoto : prompt système contient les instructions JSON et les catégories', async () => {
  let captured = null;
  const critJson = JSON.stringify({ success: true, confidence: 0.9, missing: [], excess: [], defects: [] });
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: critJson }] }; } } };
  await compareToPhoto('a', 'image/png', 'b', { client });
  const sys = sysText(captured.system);
  assert.ok(sys.includes('JSON'), 'système doit exiger un JSON');
  assert.ok(sys.includes('"missing"'), 'catégorie missing doit être dans le schéma');
  assert.ok(sys.includes('"excess"'), 'catégorie excess doit être dans le schéma');
  assert.ok(sys.includes('"defects"'), 'catégorie defects doit être dans le schéma');
  assert.ok(sys.includes('confidence'));
  assert.ok(sys.includes('pixellisation'), 'la règle d\'ignorer les artefacts MC doit rester');
});

const { STYLES, TOIT_FORMES } = require('../src/vision');

test('prompt vision : calibration d\'échelle et vocabulaires fermés', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '{"type_batiment":"x"}' }] }; } } };
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 96, validBlocks: ['stone'] });
  assert.ok(sysText(captured.system).includes('1 bloc Minecraft = 1 mètre'));
  assert.ok(sysText(captured.system).includes('une porte ≈ 2 m'));
  assert.ok(sysText(captured.system).includes('etages × 4'));
  assert.ok(sysText(captured.system).includes('PLUSIEURS bâtiments'));
  for (const s of ['medieval', 'gothique', 'haussmannien', 'brutaliste', 'chateau_fort', 'autre']) {
    assert.ok(sysText(captured.system).includes(s), `style ${s} attendu dans l'enum`);
  }
  assert.ok(sysText(captured.system).includes('plate|monopente|deux_pans|quatre_pans|conique|mansarde|dome'));
});

test('style et toit.forme hors vocabulaire → replis autre / deux_pans', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ type_batiment: 'x', style: 'roccoco-fantastique', toit: { forme: 'bizarre', materiau_suggere: 'stone' } }) }] }) } };
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.strictEqual(r.style, 'autre');
  assert.strictEqual(r.toit.forme, 'deux_pans');
});

test('STYLES exporte les 22 styles de l\'almanach + autre', () => {
  assert.strictEqual(STYLES.length, 23);
  assert.ok(STYLES.includes('asiatique_japonais'));
  assert.ok(STYLES.includes('desert_mediterraneen'));
  assert.ok(TOIT_FORMES.includes('mansarde'));
});

test('réglages API vision : thinking adaptatif effort=high, cache_control, recomposition JSON tolérante', async () => {
  let captured = null;
  // le modèle répond SANS l'accolade ouvrante (prefill assistant)
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '"type_batiment":"grange"}' }] }; } } };
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.strictEqual(r.type_batiment, 'grange');
  // thinking mode adaptatif, effort high pour l'analyse fine — et AUCUN paramètre
  // de sampling (fable-5 / opus-4-7 les rejettent avec un 400)
  assert.ok(!('temperature' in captured));
  assert.deepStrictEqual(captured.thinking, { type: 'adaptive' });
  assert.deepStrictEqual(captured.output_config, { effort: 'high' });
  assert.ok(Array.isArray(captured.system));
  assert.deepStrictEqual(captured.system[0].cache_control, { type: 'ephemeral' });
  // les modèles 4.x refusent le prefill assistant : la conversation DOIT finir par un message user
  assert.strictEqual(captured.messages[captured.messages.length - 1].role, 'user');
});

// Les modèles claude-fable-5 / claude-opus-4-7 REJETTENT temperature/top_p/top_k
// (400 "temperature is deprecated for this model") — la critique photo↔rendu
// plantait silencieusement et la correction tournait sur le seul audit générique
function captureClient(responseText) {
  const captured = {};
  return {
    captured,
    client: { messages: { create: async (params) => { captured.params = params; return { content: [{ type: 'text', text: responseText }] }; } } }
  };
}

test('analyzeImage n\'envoie aucun paramètre de sampling (fable-5 les rejette)', async () => {
  const { client, captured } = captureClient(JSON.stringify(fixture));
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.ok(!('temperature' in captured.params), 'temperature interdit sur claude-fable-5');
  assert.ok(!('top_p' in captured.params) && !('top_k' in captured.params));
});

test('compareToPhoto n\'envoie aucun paramètre de sampling (opus-4-7 les rejette)', async () => {
  const { client, captured } = captureClient('{"success": true}');
  await compareToPhoto('UEhPVE8=', 'image/jpeg', 'UkVORFU=', { client });
  assert.ok(!('temperature' in captured.params), 'temperature interdit sur claude-opus-4-7');
  assert.ok(!('top_p' in captured.params) && !('top_k' in captured.params));
});

// === Corrections audit 27/07 (CORRECTIONS-vision.md) ===

test('analyzeImage : réponse sans bloc texte → {erreur}, pas de TypeError', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }) } };
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(r.erreur, /vide/);
});

test('analyzeImage : stop_reason max_tokens → {erreur} tronquée', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"type_bat' }] }) } };
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.match(r.erreur, /tronquée/);
});

test('analyzeImage : texte préfixé avant le JSON → extrait et parsé', async () => {
  const client = fakeClient('Voici l\'analyse demandée : ' + JSON.stringify(fixture) + ' Bonne construction !');
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.strictEqual(r.type_batiment, 'maison à colombages');
});

test('compareToPhoto : réponse sans bloc texte → null (pas de correction)', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [] }) } };
  const r = await compareToPhoto('UEhPVE8=', 'image/jpeg', 'UkVORFU=', { client });
  assert.strictEqual(r, null);
});

test('schéma du prompt : palette accents/menuiseries/exterieur et travees présents', async () => {
  const { client, captured } = captureClient(JSON.stringify(fixture));
  await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  const sys = sysText(captured.params.system);
  assert.ok(sys.includes('"accents": "bloc"'), 'accents absent du schéma');
  assert.ok(sys.includes('"menuiseries": "bloc"'), 'menuiseries absent du schéma');
  assert.ok(sys.includes('"exterieur": "bloc"'), 'exterieur absent du schéma');
  assert.ok(sys.includes('"travees"'), 'travees absent du schéma');
});

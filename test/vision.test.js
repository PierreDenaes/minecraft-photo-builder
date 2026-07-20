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

test('compareToPhoto envoie les deux images et retourne la critique', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '- toit trop plat\n- tours absentes' }] }; } } };
  const critique = await compareToPhoto('UEhPVE8=', 'image/jpeg', 'UkVORFU=', { client });
  const images = captured.messages[0].content.filter((b) => b.type === 'image');
  assert.strictEqual(images.length, 2);
  assert.strictEqual(images[0].source.data, 'UEhPVE8=');
  assert.strictEqual(images[1].source.data, 'UkVORFU=');
  assert.ok(critique.includes('toit trop plat'));
});

test('compareToPhoto : panne API → null sans lever', async () => {
  const client = { messages: { create: async () => { throw new Error('panne'); } } };
  assert.strictEqual(await compareToPhoto('a', 'image/png', 'b', { client }), null);
});

test('compareToPhoto : RAS (variantes) → null, catégories dans le prompt', async () => {
  for (const ras of ['RAS', ' ras. ', 'RAS.', 'Ras']) {
    const client = { messages: { create: async () => ({ content: [{ type: 'text', text: ras }] }) } };
    assert.strictEqual(await compareToPhoto('a', 'image/png', 'b', { client }), null, `«${ras}» doit donner null`);
  }
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '[TOIT] plat -> deux pans' }] }; } } };
  const critique = await compareToPhoto('a', 'image/png', 'b', { client });
  assert.strictEqual(critique, '[TOIT] plat -> deux pans');
  assert.ok(sysText(captured.system).includes('[SILHOUETTE]'));
  assert.ok(sysText(captured.system).includes('RAS'));
  assert.ok(sysText(captured.system).includes('pixellisation'));
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

test('réglages API vision : temperature 0, cache_control, recomposition JSON tolérante', async () => {
  let captured = null;
  // le modèle répond SANS l'accolade ouvrante (prefill assistant)
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '"type_batiment":"grange"}' }] }; } } };
  const r = await analyzeImage('AAAA', 'image/jpeg', { client, maxSize: 64 });
  assert.strictEqual(r.type_batiment, 'grange');
  assert.strictEqual(captured.temperature, 0);
  assert.ok(Array.isArray(captured.system));
  assert.deepStrictEqual(captured.system[0].cache_control, { type: 'ephemeral' });
  // les modèles 4.x refusent le prefill assistant : la conversation DOIT finir par un message user
  assert.strictEqual(captured.messages[captured.messages.length - 1].role, 'user');
});

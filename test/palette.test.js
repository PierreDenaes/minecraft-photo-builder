const { test } = require('node:test');
const assert = require('node:assert');
const { clusterColors } = require('../src/palette');

test('clusterColors regroupe deux familles nettes', () => {
  const samples = [];
  for (let i = 0; i < 50; i++) samples.push([120 + (i % 5), 120, 120]); // gris
  for (let i = 0; i < 50; i++) samples.push([140, 30 + (i % 5), 30]);   // rouge
  const centroids = clusterColors(samples, 2);
  assert.strictEqual(centroids.length, 2);
  const sorted = [...centroids].sort((a, b) => a[1] - b[1]); // par canal vert
  assert.ok(Math.abs(sorted[0][0] - 140) < 10 && sorted[0][1] < 60);   // famille rouge
  assert.ok(Math.abs(sorted[1][0] - 122) < 10 && sorted[1][1] > 100);  // famille grise
});

test('clusterColors est déterministe et borne k au nombre d\'échantillons', () => {
  const samples = [[10, 10, 10], [200, 200, 200]];
  const a = clusterColors(samples, 8);
  const b = clusterColors(samples, 8);
  assert.deepStrictEqual(a, b);
  assert.ok(a.length <= 2);
});

const { THEME_BLOCKS } = require('../src/blockcolors');
const { assignThemes, buildThemePicker } = require('../src/palette');

test('les thèmes regroupent tous les blocs de leur famille', () => {
  assert.ok(THEME_BLOCKS.roche.has('stone') && THEME_BLOCKS.roche.has('tuff') && THEME_BLOCKS.roche.has('deepslate'));
  assert.ok(!THEME_BLOCKS.roche.has('oak_planks'));
  assert.ok(THEME_BLOCKS.vegetation.has('oak_leaves') && THEME_BLOCKS.vegetation.has('grass_block'));
  assert.ok(!THEME_BLOCKS.vegetation.has('stone'));
  assert.ok(THEME_BLOCKS.maconnerie.has('stone_bricks') && THEME_BLOCKS.bois.has('oak_planks'));
});

test('assignThemes sans client : repli par appartenance du bloc le plus proche', async () => {
  const colors = new Map([['stone', [126, 126, 126]], ['oak_leaves', [67, 97, 27]]]);
  const themes = await assignThemes([[120, 120, 120], [70, 100, 30]], colors, {});
  assert.strictEqual(themes[0], 'roche');
  assert.strictEqual(themes[1], 'vegetation');
});

test('assignThemes avec client : thème invalide → repli', async () => {
  const colors = new Map([['stone', [126, 126, 126]], ['oak_leaves', [67, 97, 27]]]);
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify([
    { rgb: [120, 120, 120], theme: 'maconnerie' },
    { rgb: [70, 100, 30], theme: 'theme_bidon' }
  ]) }] }) } };
  const themes = await assignThemes([[120, 120, 120], [70, 100, 30]], colors, { client });
  assert.strictEqual(themes[0], 'maconnerie');   // choix LLM accepté
  assert.strictEqual(themes[1], 'vegetation');   // invalide → repli
});

test('buildThemePicker : nuances dans le thème du centroïde le plus proche', () => {
  const colors = new Map([
    ['stone', [126, 126, 126]], ['tuff', [108, 109, 102]], ['deepslate', [80, 80, 82]],
    ['oak_leaves', [67, 97, 27]], ['grass_block', [84, 109, 51]]
  ]);
  const pick = buildThemePicker([[110, 110, 108], [75, 100, 40]], ['roche', 'vegetation'], colors);
  assert.strictEqual(pick(82, 81, 83), 'deepslate');   // nuance sombre DANS la roche
  assert.strictEqual(pick(125, 124, 126), 'stone');    // nuance claire DANS la roche
  assert.strictEqual(pick(85, 108, 50), 'grass_block'); // nuance DANS la végétation
  assert.strictEqual(pick(66, 96, 28), 'oak_leaves');
});

const { realisticMaterials } = require('../src/palette');

test('matériaux réalistes : bétons et laines exclus pour un château médiéval', () => {
  const mats = ['stone_bricks', 'black_concrete', 'red_wool', 'oak_planks', 'terracotta', 'brown_terracotta', 'lime_concrete'];
  const out = realisticMaterials(mats, { type_batiment: 'château médiéval', style: 'Renaissance' });
  assert.deepStrictEqual(out, ['stone_bricks', 'oak_planks', 'terracotta', 'brown_terracotta']);
});

test('matériaux réalistes : style cartoon conserve tout', () => {
  const mats = ['stone_bricks', 'black_concrete', 'red_wool'];
  assert.deepStrictEqual(realisticMaterials(mats, { style: 'cartoon jeu vidéo coloré' }), mats);
});

test('assignThemes : Haiku, contexte de scène dans le prompt et le message', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '[{"rgb":[100,80,60],"theme":"bois"}]' }] }; } } };
  const colors = new Map([['oak_planks', [100, 80, 60]], ['stone', [128, 128, 128]]]);
  await assignThemes([[100, 80, 60]], colors, { client, contexte: 'Scène : manoir, sol herbe, végétation dense, ambiance rurale.' });
  assert.strictEqual(captured.model, 'claude-haiku-4-5-20251001');
  assert.ok(captured.system.includes('contexte de scène'));
  assert.ok(captured.system.includes('position verticale'));
  assert.ok(captured.messages[0].content.includes('Scène : manoir'));
});

test('réglages API thèmes : temperature 0 et recomposition tableau tolérante', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '{"rgb":[10,10,10],"theme":"roche"}]' }] }; } } };
  const colors = new Map([['stone', [10, 10, 10]]]);
  const themes = await assignThemes([[10, 10, 10]], colors, { client, contexte: 'x' });
  assert.deepStrictEqual(themes, ['roche']);
  assert.strictEqual(captured.temperature, 0);
  assert.strictEqual(captured.messages[captured.messages.length - 1].role, 'user');
});

test('assignThemes reçoit la section palettes par thème de l\'almanach', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: '{"rgb":[10,10,10],"theme":"roche"}]' }] }; } } };
  await assignThemes([[10, 10, 10]], new Map([['stone', [10, 10, 10]]]), { client, contexte: 'x' });
  assert.ok(captured.messages[0].content.includes('nuançage'));
});

const { test } = require('node:test');
const assert = require('node:assert');
const { runStructureCode, generateStructure } = require('../src/generator');

const sysText = (s) => (typeof s === 'string' ? s : s.map((b) => b.text).join('\n'));

test('exécute un code valide et retourne les blocs', () => {
  const code = `function generateStructure() {
    const blocks = [];
    for (let x = 0; x < 3; x++) blocks.push({ x, y: 0, z: 0, block: 'stone' });
    return blocks;
  }
// FIN_STRUCTURE`;
  const blocks = runStructureCode(code, 5000);
  assert.strictEqual(blocks.length, 3);
  assert.deepStrictEqual(blocks[0], { x: 0, y: 0, z: 0, block: 'stone' });
});

test('rejette un code qui ne retourne pas un tableau', () => {
  assert.throws(() => runStructureCode('function generateStructure() { return 42; }', 5000), /tableau/);
});

test('tue une boucle infinie par timeout', () => {
  assert.throws(
    () => runStructureCode('function generateStructure() { while (true) {} }', 200),
    /Script execution timed out/
  );
});

test('le sandbox n\'a pas accès à require ni process', () => {
  assert.throws(() => runStructureCode('function generateStructure() { return require("fs"); }', 5000));
  assert.throws(() => runStructureCode('function generateStructure() { return process.env; }', 5000));
});

test('generateStructure appelle le LLM puis exécute le code', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: code }] }) } };
  const { blocks } = await generateStructure({ type_batiment: 'test' }, { client, timeoutMs: 5000 });
  assert.strictEqual(blocks.length, 1);
});

test('rejette une structure circulaire avec une erreur claire', () => {
  const code = `function generateStructure() {
    const a = [];
    const b = { x: 0, y: 0, z: 0, block: 'stone', ref: null };
    b.ref = b;
    a.push(b);
    return a;
  }
// FIN_STRUCTURE`;
  assert.throws(() => runStructureCode(code, 5000), /sérialisable/);
});

test('translate les coordonnées négatives vers une origine 0 (débord de toit)', () => {
  const code = `function generateStructure() {
    return [
      { x: -2, y: 0, z: -1, block: 'stone' },
      { x: 1, y: 3, z: 4, block: 'stone' }
    ];
  }
// FIN_STRUCTURE`;
  const blocks = runStructureCode(code, 5000);
  assert.deepStrictEqual(blocks[0], { x: 0, y: 0, z: 0, block: 'stone' });
  assert.deepStrictEqual(blocks[1], { x: 3, y: 3, z: 5, block: 'stone' });
});

test('injecte la liste des blocs autorisés dans le prompt', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 'test' }, { client, timeoutMs: 5000, validBlocks: ['stone', 'brick_slab'] });
  assert.match(captured.messages[0].content, /Blocs autorisés/);
  assert.match(captured.messages[0].content, /brick_slab/);
});

test('signale clairement une réponse tronquée (max_tokens)', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'function generateStructure() { return [' }] }) } };
  await assert.rejects(
    () => generateStructure({ type_batiment: 'test' }, { client, timeoutMs: 5000 }),
    /tronquée/
  );
});

test('injecte le résumé structurel dans le prompt', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  const structuralSummary = { dims: { x: 40, y: 25, z: 30 }, towers: [{ cx: 5, cz: 5, radius: 3, height: 25 }] };
  await generateStructure({ type_batiment: 'château' }, { client, timeoutMs: 5000, structuralSummary });
  assert.match(captured.messages[0].content, /Résumé structurel/);
  assert.match(captured.messages[0].content, /"height":25/);
  assert.match(sysText(captured.system), /architecte/i);
});

test('le prompt architecte explique la carte ASCII', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000, structuralSummary: { carte: ['90', '00'] } });
  assert.match(sysText(captured.system), /vue de dessus ASCII/);
});

test('le prompt exige toits complets, planchers et escaliers', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  assert.match(sysText(captured.system), /toit.*COMPLET/i);
  assert.match(sysText(captured.system), /plancher/i);
  assert.match(sysText(captured.system), /escalier/i);
  assert.ok(!/intérieurs sont creux/.test(sysText(captured.system)), 'règle creux encore présente');
});

test('le prompt interdit les toits en débord', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  assert.match(sysText(captured.system), /déborde/);
});

test('l\'architecte reçoit la photo de référence quand elle est fournie', async () => {
  const codeImg = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: codeImg }] }; } } };
  await generateStructure({ type_batiment: 'maison' }, { client, timeoutMs: 5000, image: { base64: 'QUJD', mimeType: 'image/jpeg' } });
  const content = captured.messages[0].content;
  assert.ok(Array.isArray(content), 'contenu multimodal attendu (tableau image + texte)');
  const img = content.find((b) => b.type === 'image');
  assert.strictEqual(img.source.data, 'QUJD');
  assert.strictEqual(img.source.media_type, 'image/jpeg');
  const txt = content.find((b) => b.type === 'text');
  assert.ok(txt.text.includes('Écris generateStructure()'));
  assert.ok(/référence/.test(txt.text), 'consigne de fidélité à la photo attendue');
});

test('sans photo, le contenu reste une chaîne simple (compat)', async () => {
  const codeImg = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: codeImg }] }; } } };
  await generateStructure({ type_batiment: 'maison' }, { client, timeoutMs: 5000 });
  assert.strictEqual(typeof captured.messages[0].content, 'string');
});

// ---- Itération 10 : états, sentinelle, correction v1, boucle erreur ----
const OK_CODE = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }\n// FIN_STRUCTURE';

test('sentinelle : réponse sans // FIN_STRUCTURE rejetée comme tronquée, SANS retentative', async () => {
  let calls = 0;
  const client = { messages: { create: async () => { calls++; return { content: [{ type: 'text', text: 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }' }] }; } } };
  await assert.rejects(() => generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 }), /tronqu/);
  assert.strictEqual(calls, 1);
});

test('le message de retry ne duplique pas le référentiel almanach', async () => {
  const bad = 'function generateStructure() { throw new Error("x"); }\n// FIN_STRUCTURE';
  const reqs = [];
  let call = 0;
  const client = { messages: { create: async (req) => { reqs.push(req); call++; return { content: [{ type: 'text', text: call === 1 ? bad : OK_CODE }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  const retryMsg = reqs[1].messages[reqs[1].messages.length - 1].content;
  assert.ok(!retryMsg.includes('Référentiel de construction'), retryMsg.slice(0, 200));
});

test('generateStructure retourne { blocks, code }', async () => {
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: OK_CODE }] }) } };
  const out = await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  assert.ok(Array.isArray(out.blocks));
  assert.strictEqual(out.blocks[0].block, 'stone');
  assert.ok(out.code.includes('generateStructure'));
});

test('correction : code v1, écarts et consigne MODIFIE dans le message, photo jointe', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: OK_CODE }] }; } } };
  await generateStructure({ type_batiment: 't' }, {
    client, timeoutMs: 5000,
    image: { base64: 'QUJD', mimeType: 'image/jpeg' },
    correction: { codeV1: 'function generateStructure() { return AAA; }', critique: '[TOIT] plat -> deux pans', defauts: '- aucune entrée' }
  });
  const txt = captured.messages[0].content.find((b) => b.type === 'text').text;
  assert.ok(txt.includes('<code_v1>'));
  assert.ok(txt.includes('return AAA'));
  assert.ok(txt.includes('[TOIT] plat -> deux pans'));
  assert.ok(txt.includes('aucune entrée'));
  assert.ok(/MODIFIE ce code/.test(txt));
  assert.ok(captured.messages[0].content.some((b) => b.type === 'image'));
});

test('erreur runtime réinjectée : la seconde tentative reçoit le message d\'erreur', async () => {
  const bad = 'function generateStructure() { throw new Error("boom_xyz"); }\n// FIN_STRUCTURE';
  const reqs = [];
  let call = 0;
  const client = { messages: { create: async (req) => { reqs.push(req); call++; return { content: [{ type: 'text', text: call === 1 ? bad : OK_CODE }] }; } } };
  const out = await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  assert.strictEqual(out.blocks[0].block, 'stone');
  assert.strictEqual(reqs.length, 2);
  const retryText = JSON.stringify(reqs[1].messages);
  assert.ok(retryText.includes('boom_xyz'));
});

test('trois échecs d\'exécution → erreur remontée', async () => {
  const bad = 'function generateStructure() { throw new Error("toujours"); }\n// FIN_STRUCTURE';
  let calls = 0;
  const client = { messages: { create: async () => { calls++; return { content: [{ type: 'text', text: bad }] }; } } };
  await assert.rejects(() => generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 }), /toujours/);
  assert.strictEqual(calls, 3);
});

test('portes : la moitié haute est complétée mécaniquement', async () => {
  const doorCode = 'function generateStructure() { return [{ x: 1, y: 0, z: 0, block: "stone" }, { x: 0, y: 0, z: 0, block: "oak_door[facing=south,half=lower]" }]; }\n// FIN_STRUCTURE';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: doorCode }] }) } };
  const out = await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  const upper = out.blocks.find((b) => b.block === 'oak_door[facing=south,half=upper]');
  assert.ok(upper, 'moitié haute attendue');
  assert.strictEqual(upper.x, 0);
  assert.strictEqual(upper.y, 1);
});

test('réglages API générateur : temperature 0.2 et cache_control sur le system', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: OK_CODE }] }; } } };
  await generateStructure({ type_batiment: 't' }, { client, timeoutMs: 5000 });
  assert.strictEqual(captured.temperature, 0.2);
  assert.ok(Array.isArray(captured.system));
  assert.deepStrictEqual(captured.system[0].cache_control, { type: 'ephemeral' });
});

test('référentiel almanach routé : échelle, fiches style/toit, façades, anti-patterns', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: OK_CODE }] }; } } };
  await generateStructure({ type_batiment: 'manoir', style: 'medieval', toit: { forme: 'conique' }, elements: ['tour d\'angle'], cadrage: 'scene_complete' }, { client, timeoutMs: 5000 });
  const txt = captured.messages[0].content;
  assert.ok(txt.includes('Référentiel de construction'));
  assert.ok(txt.includes('1 bloc = 1 mètre'));           // section 1
  assert.ok(txt.includes('colombages'));                  // fiche medieval
  assert.ok(txt.includes('anneaux'));                     // fiche toit conique
  assert.ok(txt.includes('règle de la profondeur'));      // section 4
  assert.ok(txt.includes('Anti-patterns'));               // section 10
  assert.ok(txt.includes('Cercle par test de distance')); // section 6 (tour détectée)
  assert.ok(txt.includes('Terrain et abords'));           // section 9 (scene_complete)
});

test('référentiel minimal sans tour ni scène : pas de sections 6 et 9', async () => {
  let captured = null;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: OK_CODE }] }; } } };
  await generateStructure({ type_batiment: 'grange', style: 'rustique' }, { client, timeoutMs: 5000 });
  const txt = captured.messages[0].content;
  assert.ok(!txt.includes('Cercle par test de distance'));
  assert.ok(!txt.includes('Terrain et abords'));
});

test('bloc hors liste blanche → réinjecté dans la boucle, corrigé à la 2e tentative', async () => {
  const bad = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "smooth_stone_wall" }]; }\n// FIN_STRUCTURE';
  const good = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "smooth_stone_slab[type=bottom]" }]; }\n// FIN_STRUCTURE';
  const reqs = [];
  let call = 0;
  const client = { messages: { create: async (req) => { reqs.push(req); call++; return { content: [{ type: 'text', text: call === 1 ? bad : good }] }; } } };
  const out = await generateStructure({ type_batiment: 't' }, {
    client, timeoutMs: 5000, validBlocks: ['smooth_stone', 'smooth_stone_slab']
  });
  assert.strictEqual(out.blocks[0].block, 'smooth_stone_slab[type=bottom]');
  assert.strictEqual(reqs.length, 2);
  assert.ok(JSON.stringify(reqs[1].messages).includes('smooth_stone_wall'));
});

test('les variantes hors palette mais existantes passent ; les blocs inventés sont retentés', async () => {
  const withStairs = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "oak_stairs[facing=north]" }]; }\n// FIN_STRUCTURE';
  let calls = 0;
  const client = { messages: { create: async () => { calls++; return { content: [{ type: 'text', text: withStairs }] }; } } };
  const out = await generateStructure({ type_batiment: 't' }, {
    client, timeoutMs: 5000,
    validBlocks: ['white_concrete'],               // palette de style (sans stairs)
    existingBlocks: ['white_concrete', 'oak_stairs'] // liste blanche complète
  });
  assert.strictEqual(out.blocks[0].block, 'oak_stairs[facing=north]');
  assert.strictEqual(calls, 1, 'aucune retentative attendue pour un bloc existant');
});

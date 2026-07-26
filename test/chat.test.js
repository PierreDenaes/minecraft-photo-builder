const { test } = require('node:test');
const assert = require('node:assert');
const { createChatHandler } = require('../src/chat');

function setup(builderOverrides = {}) {
  const messages = [];
  const bot = {
    username: 'BuilderBot',
    chat: (m) => messages.push(m),
    players: { Steve: { entity: { position: { x: 0.5, y: -60, z: 0.5 }, yaw: 0 } } }
  };
  const calls = [];
  const defaultBuilder = {
    computeOrigin: (...args) => { calls.push(['computeOrigin', args]); return { x: 0, y: -60, z: -9 }; },
    startBuild: (...args) => { calls.push(['startBuild', args]); return { total: 42 }; },
    undo: () => { calls.push(['undo']); return 'snapshot'; },
    status: () => ({ active: true, done: 10, total: 42 }),
    estimateSeconds: () => 2
  };
  const builder = { ...defaultBuilder, ...builderOverrides };
  const pending = new Map();
  const config = { web: { port: 3000, public_host: 'localhost' }, limits: { max_size: 64, max_blocks: 100000 } };
  const handle = createChatHandler({ bot, builder, config, pending, tpDelayMs: 30 });
  return { messages, calls, pending, handle, bot };
}

test('!photo donne le lien d\'upload', () => {
  const { messages, handle } = setup();
  handle('Steve', '!photo');
  assert.match(messages[0], /http:\/\/localhost:3000\/upload\/Steve/);
});

test('!go sans proposition en attente informe le joueur', () => {
  const { messages, calls, handle } = setup();
  handle('Steve', '!go');
  assert.strictEqual(calls.length, 0);
  assert.match(messages[0], /aucune/i);
});

test('!go avec proposition lance la construction', () => {
  const { calls, pending, handle, messages } = setup();
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  const co = calls.find((c) => c[0] === 'computeOrigin');
  assert.deepStrictEqual(co[1][0], { x: 0.5, y: -60, z: 0.5 }); // position
  assert.strictEqual(co[1][1], 0);                              // yaw
  assert.deepStrictEqual(co[1][2], { x: 1, y: 1, z: 1 });       // size
  assert.strictEqual(calls.find((c) => c[0] === 'startBuild')[0], 'startBuild');
  assert.strictEqual(pending.has('steve'), false);
  assert.match(messages.join(' '), /construction/i);
});

test('!go consomme la proposition même si startBuild lève', () => {
  const { messages, pending, handle } = setup({
    startBuild: () => { throw new Error('boom'); }
  });
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  assert.doesNotThrow(() => handle('Steve', '!go'));
  assert.strictEqual(pending.has('steve'), false);
  assert.match(messages.join(' '), /erreur/i);
  assert.match(messages.join(' '), /boom/);
});

test('!cancel vide la proposition', () => {
  const { pending, handle, messages } = setup();
  pending.set('steve', { blocks: [], size: {}, description: {} });
  handle('Steve', '!cancel');
  assert.strictEqual(pending.has('steve'), false);
  assert.match(messages[0], /annul/i);
});

test('!undo appelle builder.undo', () => {
  const { calls, handle } = setup();
  handle('Steve', '!undo');
  assert.deepStrictEqual(calls[0], ['undo']);
});

test('!status affiche la progression', () => {
  const { messages, handle } = setup();
  handle('Steve', '!status');
  assert.match(messages[0], /10\/42/);
});

test('ignore ses propres messages', () => {
  const { messages, handle } = setup();
  handle('BuilderBot', '!photo');
  assert.strictEqual(messages.length, 0);
});

test('!cancel sans proposition répond "rien à annuler"', () => {
  const { messages, handle } = setup();
  handle('Steve', '!cancel');
  assert.match(messages[0], /rien à annuler/i);
});

test('!undo sans construction répond "aucune"', () => {
  const { messages, handle } = setup({ undo: () => false });
  handle('Steve', '!undo');
  assert.match(messages[0], /aucune construction à annuler/i);
});

test('!status sans construction répond "aucune"', () => {
  const { messages, handle } = setup({ status: () => ({ active: false, done: 0, total: 0 }) });
  handle('Steve', '!status');
  assert.match(messages[0], /aucune construction en cours/i);
});

test('!status terminé affiche le suffixe', () => {
  const { messages, handle } = setup({ status: () => ({ active: false, done: 42, total: 42 }) });
  handle('Steve', '!status');
  assert.match(messages[0], /42\/42.*\(terminé\)/);
});

test('!go joueur hors de vue : le bot se téléporte puis lance', async () => {
  const { messages, calls, pending, handle, bot } = setup();
  delete bot.players.Steve;
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  assert.strictEqual(messages[0], '/tp BuilderBot Steve');
  bot.players.Steve = { entity: { position: { x: 9.5, y: -60, z: 9.5 }, yaw: 0 } };
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(calls.find((c) => c[0] === 'startBuild'));
  assert.strictEqual(pending.has('steve'), false);
  assert.match(messages.join(' '), /lancée/);
});

test('!diorama donne le lien d\'upload avec mode=diorama', () => {
  const { messages, handle } = setup();
  handle('Steve', '!diorama');
  assert.match(messages[0], /http:\/\/localhost:3000\/upload\/Steve\?mode=diorama/);
});

test('!go joueur introuvable même après téléportation : message et proposition conservée', async () => {
  const { messages, calls, pending, handle, bot } = setup();
  delete bot.players.Steve;
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  await new Promise((r) => setTimeout(r, 90));
  assert.strictEqual(calls.find((c) => c[0] === 'startBuild'), undefined);
  assert.match(messages.join(' '), /je ne te vois pas/);
  assert.strictEqual(pending.has('steve'), true);
});

test('!go annonce l\'emprise et le centre', () => {
  const { messages, pending, handle } = setup();
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 10, y: 5, z: 8 },
    description: { type_batiment: 'test' }
  });
  handle('Steve', '!go');
  const m = messages.join(' | ');
  assert.match(m, /Emprise : \(0,-9\) → \(9,-2\), centre \(5,-5\)/);
});

test('!go retrouve une proposition enregistrée avec une casse différente', () => {
  const { calls, pending, handle } = setup();
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  assert.ok(calls.find((c) => c[0] === 'startBuild'), 'construction non lancée malgré la proposition');
  assert.strictEqual(pending.has('steve'), false);
});

test('!statue donne le lien mode=statue', () => {
  const { messages, handle } = setup();
  handle('Steve', '!statue');
  assert.match(messages[0], /upload\/Steve\?mode=statue/);
});

test('!tourner pivote la proposition en attente', () => {
  const { messages, pending, handle } = setup();
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }, { x: 3, y: 0, z: 1, block: 'dirt' }],
    size: { x: 4, y: 1, z: 2 },
    description: { type_batiment: 'statue' }
  });
  handle('Steve', '!tourner');
  const p = pending.get('steve');
  assert.deepStrictEqual(p.size, { x: 2, y: 1, z: 4 }); // dimensions x/z échangées
  assert.ok(p.blocks.some((b) => b.block === 'dirt' && b.x === 1 && b.z === 0));
  assert.match(messages.join(' '), /pivotée/);
});

test('!tourner sans proposition informe', () => {
  const { messages, handle } = setup();
  handle('Steve', '!tourner');
  assert.match(messages[0], /aucune proposition/i);
});

test('!tourner après !go : undo + nouvelle proposition pivotée', () => {
  const { messages, calls, pending, handle } = setup();
  pending.set('steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }, { x: 3, y: 0, z: 1, block: 'dirt' }],
    size: { x: 4, y: 1, z: 2 },
    description: { type_batiment: 'statue' }
  });
  handle('Steve', '!go');                       // consomme et construit
  assert.strictEqual(pending.has('steve'), false);
  handle('Steve', '!tourner');                  // après coup : undo + re-proposition pivotée
  assert.ok(calls.some((c) => c[0] === 'undo'), 'undo non déclenché');
  const p = pending.get('steve');
  assert.ok(p, 'proposition pivotée absente');
  assert.deepStrictEqual(p.size, { x: 2, y: 1, z: 4 });
  assert.match(messages.join(' '), /pivotée/);
});

test('!redresser bascule la proposition (y/z échangés)', () => {
  const { messages, pending, handle } = setup();
  pending.set('steve', {
    blocks: [{ x: 0, y: 3, z: 1, block: 'stone' }],
    size: { x: 2, y: 4, z: 2 },
    description: { type_batiment: 'statue' }
  });
  handle('Steve', '!redresser');
  const p = pending.get('steve');
  // taille recalculée depuis les blocs réels : (0,3,1) redressé → (0,1,0)
  assert.deepStrictEqual(p.size, { x: 1, y: 2, z: 1 });
  assert.match(messages.join(' '), /redressée/);
});

test('!redresser préserve le socle à plat sous la nouvelle emprise', () => {
  const { pending, handle } = setup();
  const socleBlocks = [];
  for (let x = 0; x <= 3; x++) for (let z = 0; z <= 3; z++) for (let y = 0; y < 2; y++) socleBlocks.push({ x, y, z, block: 'smooth_stone' });
  pending.set('steve', {
    blocks: [...socleBlocks, { x: 1, y: 2, z: 1, block: 'red_wool' }, { x: 1, y: 5, z: 2, block: 'blue_wool' }],
    size: { x: 4, y: 6, z: 4 },
    description: { type_batiment: 'statue' },
    socle: { h: 2, block: 'smooth_stone', margin: 1 }
  });
  handle('Steve', '!redresser');
  const p = pending.get('steve');
  const socle = p.blocks.filter((b) => b.block === 'smooth_stone');
  const statue = p.blocks.filter((b) => b.block !== 'smooth_stone');
  assert.ok(socle.every((b) => b.y < 2), 'socle non plat');
  assert.ok(statue.every((b) => b.y >= 2), 'statue sous le socle');
  const sMinX = Math.min(...statue.map((b) => b.x));
  const socMinX = Math.min(...socle.map((b) => b.x));
  assert.ok(socMinX <= sMinX - 1, 'marge du socle absente');
});

test('4 rotations !tourner reviennent à l\'identique (pas de dérive de marge)', () => {
  const { pending, handle } = setup();
  const socleBlocks = [];
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) for (let y = 0; y < 2; y++) socleBlocks.push({ x, y, z, block: 'smooth_stone' });
  const body = [{ x: 1, y: 2, z: 2, block: 'red_wool' }, { x: 3, y: 4, z: 1, block: 'blue_wool' }];
  pending.set('steve', {
    blocks: [...socleBlocks, ...body], size: { x: 5, y: 5, z: 5 },
    description: { type_batiment: 'statue' }, socle: { h: 2, block: 'smooth_stone', margin: 1 }
  });
  const bodyOf = (blocks) => JSON.stringify(blocks.filter((b) => b.block !== 'smooth_stone')
    .sort((a, b2) => a.x - b2.x || a.y - b2.y || a.z - b2.z));
  const snapshot = bodyOf(pending.get('steve').blocks);
  for (let i = 0; i < 4; i++) handle('Steve', '!tourner');
  const p4 = pending.get('steve');
  assert.strictEqual(bodyOf(p4.blocks), snapshot, 'dérive du corps après 4 rotations');
  // le socle est régénéré canoniquement : toujours plat, jamais cumulatif
  assert.ok(p4.blocks.filter((b) => b.block === 'smooth_stone').every((b) => b.y < 2));
});

test('!redresser après !go garde le socle à plat (métadonnée socle transmise)', () => {
  const { pending, handle } = setup();
  const socleBlocks = [];
  for (let x = 0; x <= 3; x++) for (let z = 0; z <= 3; z++) for (let y = 0; y < 2; y++) socleBlocks.push({ x, y, z, block: 'smooth_stone' });
  pending.set('steve', {
    blocks: [...socleBlocks, { x: 1, y: 2, z: 1, block: 'red_wool' }, { x: 1, y: 5, z: 1, block: 'blue_wool' }],
    size: { x: 4, y: 6, z: 4 }, description: { type_batiment: 'statue' },
    socle: { h: 2, block: 'smooth_stone', margin: 1 }
  });
  handle('Steve', '!go');
  handle('Steve', '!redresser');
  const p = pending.get('steve');
  const socle = p.blocks.filter((b) => b.block === 'smooth_stone');
  assert.ok(socle.length > 0 && socle.every((b) => b.y < 2), 'socle devenu mur après !go + !redresser');
});

test('!portrait donne le lien mode=portrait', () => {
  const { messages, handle } = setup();
  handle('Steve', '!portrait');
  assert.match(messages[0], /upload\/Steve\?mode=portrait/);
});


test('!schema donne le lien mode=schema', () => {
  const { messages, handle } = setup();
  handle('Steve', '!schema');
  assert.match(messages[0], /upload\/Steve\?mode=schema/);
});

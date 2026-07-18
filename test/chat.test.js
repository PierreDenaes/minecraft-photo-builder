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
  pending.set('Steve', {
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
  assert.strictEqual(pending.has('Steve'), false);
  assert.match(messages.join(' '), /construction/i);
});

test('!go consomme la proposition même si startBuild lève', () => {
  const { messages, pending, handle } = setup({
    startBuild: () => { throw new Error('boom'); }
  });
  pending.set('Steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  assert.doesNotThrow(() => handle('Steve', '!go'));
  assert.strictEqual(pending.has('Steve'), false);
  assert.match(messages.join(' '), /erreur/i);
  assert.match(messages.join(' '), /boom/);
});

test('!cancel vide la proposition', () => {
  const { pending, handle, messages } = setup();
  pending.set('Steve', { blocks: [], size: {}, description: {} });
  handle('Steve', '!cancel');
  assert.strictEqual(pending.has('Steve'), false);
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
  pending.set('Steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  assert.strictEqual(messages[0], '/tp BuilderBot Steve');
  bot.players.Steve = { entity: { position: { x: 9.5, y: -60, z: 9.5 }, yaw: 0 } };
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(calls.find((c) => c[0] === 'startBuild'));
  assert.strictEqual(pending.has('Steve'), false);
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
  pending.set('Steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 1, y: 1, z: 1 },
    description: { type_batiment: 'cabane' }
  });
  handle('Steve', '!go');
  await new Promise((r) => setTimeout(r, 90));
  assert.strictEqual(calls.find((c) => c[0] === 'startBuild'), undefined);
  assert.match(messages.join(' '), /je ne te vois pas/);
  assert.strictEqual(pending.has('Steve'), true);
});

test('!go annonce l\'emprise et le centre', () => {
  const { messages, pending, handle } = setup();
  pending.set('Steve', {
    blocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    size: { x: 10, y: 5, z: 8 },
    description: { type_batiment: 'test' }
  });
  handle('Steve', '!go');
  const m = messages.join(' | ');
  assert.match(m, /Emprise : \(0,-9\) → \(9,-2\), centre \(5,-5\)/);
});

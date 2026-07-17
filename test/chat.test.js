const { test } = require('node:test');
const assert = require('node:assert');
const { createChatHandler } = require('../src/chat');

function setup() {
  const messages = [];
  const bot = {
    username: 'BuilderBot',
    chat: (m) => messages.push(m),
    players: { Steve: { entity: { position: { x: 0.5, y: -60, z: 0.5 }, yaw: 0 } } }
  };
  const calls = [];
  const builder = {
    computeOrigin: () => ({ x: 0, y: -60, z: -9 }),
    startBuild: (...args) => { calls.push(['startBuild', args]); return { total: 42 }; },
    undo: () => { calls.push(['undo']); return true; },
    status: () => ({ active: true, done: 10, total: 42 }),
    estimateSeconds: () => 2
  };
  const pending = new Map();
  const config = { web: { port: 3000, public_host: 'localhost' }, limits: { max_size: 64, max_blocks: 100000 } };
  const handle = createChatHandler({ bot, builder, config, pending });
  return { messages, calls, pending, handle };
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
  assert.strictEqual(calls[0][0], 'startBuild');
  assert.strictEqual(pending.has('Steve'), false);
  assert.match(messages.join(' '), /construction/i);
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

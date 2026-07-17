const { test } = require('node:test');
const assert = require('node:assert');
const { Builder } = require('../src/builder');

function fakeBot() {
  const sent = [];
  return {
    sent,
    chat: (cmd) => sent.push(cmd),
    blockAt: () => ({ name: 'air' })
  };
}

test('computeOrigin place la structure 5 blocs devant le joueur (regard -z)', () => {
  const b = new Builder(fakeBot(), { maxBlocks: 100000 });
  // yaw 0 en mineflayer = regard vers -z (nord)... vérifié en jeu Task 10
  const origin = b.computeOrigin({ x: 0.5, y: -60, z: 0.5 }, 0, { x: 4, y: 3, z: 4 });
  assert.deepStrictEqual(origin, { x: -2, y: -60, z: -8 });
});

test('flattenCommands couvre emprise + 1 par couches y', () => {
  const b = new Builder(fakeBot(), { maxBlocks: 100000 });
  const cmds = b.flattenCommands({ x: 10, y: -60, z: 10 }, { x: 4, y: 3, z: 4 });
  assert.strictEqual(cmds.length, 4); // 3 couches d'air + 1 sol
  assert.strictEqual(cmds[0], '/fill 9 -61 9 14 -61 14 dirt');
  assert.strictEqual(cmds[1], '/fill 9 -60 9 14 -60 14 air');
  assert.strictEqual(cmds[3], '/fill 9 -58 9 14 -58 14 air');
});

test('startBuild envoie les commandes de manière throttlée', async () => {
  const bot = fakeBot();
  const b = new Builder(bot, { maxBlocks: 100000 });
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 0, y: 1, z: 0, block: 'stone' },
    { x: 0, y: 2, z: 0, block: 'stone' }
  ];
  const { total } = b.startBuild(blocks, { x: 0, y: -60, z: 0 }, { x: 1, y: 3, z: 1 });
  assert.ok(total > 3); // flatten + 3 setblock
  await new Promise((r) => setTimeout(r, 50 * total));
  assert.strictEqual(bot.sent.length, total);
  assert.strictEqual(b.status().active, false);
  assert.strictEqual(b.status().done, total);
});

test('undo restaure le snapshot', async () => {
  const bot = fakeBot();
  bot.blockAt = () => ({ name: 'grass_block' });
  const b = new Builder(bot, { maxBlocks: 100000 });
  b.startBuild([{ x: 0, y: 0, z: 0, block: 'stone' }], { x: 0, y: -60, z: 0 }, { x: 1, y: 1, z: 1 });
  await new Promise((r) => setTimeout(r, 500));
  bot.sent.length = 0;
  assert.strictEqual(b.undo(), true);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(bot.sent.some((c) => c.includes('grass_block')));
  assert.strictEqual(b.undo(), false);
});

test('enqueue pendant un drain actif cumule la progression sans la remettre à zéro', async () => {
  const bot = fakeBot();
  const b = new Builder(bot, { maxBlocks: 100000 });
  b.startBuild(
    [
      { x: 0, y: 0, z: 0, block: 'stone' },
      { x: 0, y: 1, z: 0, block: 'stone' },
      { x: 0, y: 2, z: 0, block: 'stone' },
      { x: 0, y: 3, z: 0, block: 'stone' }
    ],
    { x: 0, y: -60, z: 0 },
    { x: 1, y: 4, z: 1 }
  );
  const initialTotal = b.status().total;
  await new Promise((r) => setTimeout(r, 120)); // laisser partir quelques commandes
  const doneBefore = b.status().done;
  assert.ok(doneBefore > 0);
  b.enqueue(['/setblock 0 0 0 stone', '/setblock 0 1 0 stone']);
  const s = b.status();
  assert.strictEqual(s.total, initialTotal + 2);
  assert.ok(s.done >= doneBefore); // pas de remise à zéro
  await new Promise((r) => setTimeout(r, 50 * s.total));
  assert.strictEqual(b.status().done, initialTotal + 2);
  assert.strictEqual(b.status().active, false);
});

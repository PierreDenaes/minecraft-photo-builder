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
  // fakeBot renvoie air partout → groundLevelAt fallback = floor(-60) = -60,
  // computeOrigin retire 1 → origin.y = -61 (le bloc solide que la dalle remplace)
  const origin = b.computeOrigin({ x: 0.5, y: -60, z: 0.5 }, 0, { x: 4, y: 3, z: 4 });
  assert.deepStrictEqual(origin, { x: -2, y: -61, z: -8 });
});

test('flattenCommands pose du dirt au niveau du sol (origin.y) et vide au-dessus', () => {
  const b = new Builder(fakeBot(), { maxBlocks: 100000 });
  const cmds = b.flattenCommands({ x: 10, y: -60, z: 10 }, { x: 4, y: 3, z: 4 });
  // origin.y = -60 = bloc de sol. dirt AU même niveau. air de -59 à -57 (3 couches).
  assert.strictEqual(cmds.length, 4);
  assert.strictEqual(cmds[0], '/fill 9 -60 9 14 -60 14 dirt');
  assert.strictEqual(cmds[1], '/fill 9 -59 9 14 -59 14 air');
  assert.strictEqual(cmds[3], '/fill 9 -57 9 14 -57 14 air');
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
  assert.strictEqual(b.undo(), 'snapshot');
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

test('cmdsPerTick configurable accélère le drain', async () => {
  const bot = fakeBot();
  const b = new Builder(bot, { maxBlocks: 100000, cmdsPerTick: 8 });
  b.enqueue(Array.from({ length: 16 }, (_, i) => `/setblock ${i} 0 0 stone`));
  await new Promise((r) => setTimeout(r, 160)); // 16 cmds à 8/50ms = 2 ticks
  assert.strictEqual(bot.sent.length, 16);
  assert.strictEqual(b.status().active, false);
});

test('undo sans snapshot (volume trop grand) restaure le terrain plat', async () => {
  const bot = fakeBot();
  const b = new Builder(bot, { maxBlocks: 10 }); // cap minuscule → takeSnapshot retourne null
  b.startBuild([{ x: 0, y: 0, z: 0, block: 'stone' }], { x: 0, y: -60, z: 0 }, { x: 4, y: 3, z: 4 });
  await new Promise((r) => setTimeout(r, 600));
  bot.sent.length = 0;
  assert.strictEqual(b.undo(), 'flat');
  await new Promise((r) => setTimeout(r, 600));
  // undoFlatCommands avec nouveau contrat : grass_block AU sol (origin.y=-60),
  // air à partir de origin.y+1 = -59 jusqu'à -57.
  assert.ok(bot.sent.some((c) => c === '/fill -1 -59 -1 4 -59 4 air'));
  assert.ok(bot.sent.some((c) => c === '/fill -1 -60 -1 4 -60 4 grass_block'));
  assert.strictEqual(b.undo(), false); // lastBuild consommé
});

test('enqueue supporte un très grand nombre de commandes sans exploser la pile', () => {
  const bot = fakeBot();
  const b = new Builder(bot, { maxBlocks: 100000 });
  const cmds = new Array(250000).fill('/setblock 0 0 0 stone');
  assert.doesNotThrow(() => b.enqueue(cmds));
  assert.strictEqual(b.status().total, 250000);
  clearInterval(b.timer); // ne pas drainer 250k commandes dans le test
});

test('computeOrigin ancre y sur le bloc de sol (dalle flush avec le terrain)', () => {
  const bot = fakeBot();
  bot.blockAt = (v) => ({ name: v.y <= -61 ? 'grass_block' : 'air' });
  const b = new Builder(bot, { maxBlocks: 100000 });
  const origin = b.computeOrigin({ x: 0.5, y: -49.5, z: 0.5 }, 0, { x: 4, y: 3, z: 4 });
  // premier solide à -61 → groundLevelAt renvoie -60 (surface = 1er air) →
  // computeOrigin retire 1 pour que la dalle REMPLACE le grass_block à -61.
  assert.strictEqual(origin.y, -61);
});

test('groundLevelAt replie sur floor(pos.y) si aucun sol à portée', () => {
  const bot = fakeBot();
  bot.blockAt = () => ({ name: 'air' });
  const b = new Builder(bot, { maxBlocks: 100000 });
  assert.strictEqual(b.groundLevelAt({ x: 0, y: -49.5, z: 0 }), -50);
});

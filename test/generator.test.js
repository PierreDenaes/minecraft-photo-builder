const { test } = require('node:test');
const assert = require('node:assert');
const { runStructureCode, generateStructure } = require('../src/generator');

test('exécute un code valide et retourne les blocs', () => {
  const code = `function generateStructure() {
    const blocks = [];
    for (let x = 0; x < 3; x++) blocks.push({ x, y: 0, z: 0, block: 'stone' });
    return blocks;
  }`;
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
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }';
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: code }] }) } };
  const blocks = await generateStructure({ type_batiment: 'test' }, { client, timeoutMs: 5000 });
  assert.strictEqual(blocks.length, 1);
});

test('rejette une structure circulaire avec une erreur claire', () => {
  const code = `function generateStructure() {
    const a = [];
    const b = { x: 0, y: 0, z: 0, block: 'stone', ref: null };
    b.ref = b;
    a.push(b);
    return a;
  }`;
  assert.throws(() => runStructureCode(code, 5000), /sérialisable/);
});

test('translate les coordonnées négatives vers une origine 0 (débord de toit)', () => {
  const code = `function generateStructure() {
    return [
      { x: -2, y: 0, z: -1, block: 'stone' },
      { x: 1, y: 3, z: 4, block: 'stone' }
    ];
  }`;
  const blocks = runStructureCode(code, 5000);
  assert.deepStrictEqual(blocks[0], { x: 0, y: 0, z: 0, block: 'stone' });
  assert.deepStrictEqual(blocks[1], { x: 3, y: 3, z: 5, block: 'stone' });
});

test('injecte la liste des blocs autorisés dans le prompt', async () => {
  const code = 'function generateStructure() { return [{ x: 0, y: 0, z: 0, block: "stone" }]; }';
  let captured;
  const client = { messages: { create: async (req) => { captured = req; return { content: [{ type: 'text', text: code }] }; } } };
  await generateStructure({ type_batiment: 'test' }, { client, timeoutMs: 5000, validBlocks: ['stone', 'brick_slab'] });
  assert.match(captured.messages[0].content, /Blocs autorisés/);
  assert.match(captured.messages[0].content, /brick_slab/);
});

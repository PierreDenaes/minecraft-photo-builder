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

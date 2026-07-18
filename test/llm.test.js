const { test } = require('node:test');
const assert = require('node:assert');
const { stripCodeFences } = require('../src/llm');

test('retire les fences même avec un saut de ligne en tête', () => {
  assert.strictEqual(stripCodeFences('\n```javascript\nconst a = 1;\n```'), 'const a = 1;');
  assert.strictEqual(stripCodeFences('```js\nconst b = 2;\n```\n'), 'const b = 2;');
  assert.strictEqual(stripCodeFences('const c = 3;'), 'const c = 3;');
});

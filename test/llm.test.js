const { test } = require('node:test');
const assert = require('node:assert');
const { stripCodeFences, withRetry } = require('../src/llm');

test('retire les fences même avec un saut de ligne en tête', () => {
  assert.strictEqual(stripCodeFences('\n```javascript\nconst a = 1;\n```'), 'const a = 1;');
  assert.strictEqual(stripCodeFences('```js\nconst b = 2;\n```\n'), 'const b = 2;');
  assert.strictEqual(stripCodeFences('const c = 3;'), 'const c = 3;');
});

// withRetry ne doit PAS retenter les 4xx définitifs (400 param invalide, 401,
// 404...) — vu en prod : 400 « temperature is deprecated » retenté pour rien.
// 408/429 et les 5xx restent retentés.
test('withRetry : 400 → échec immédiat sans retry', async () => {
  let calls = 0;
  const err = Object.assign(new Error('invalid_request'), { status: 400 });
  await assert.rejects(
    () => withRetry(() => { calls++; throw err; }, { retries: 3, baseDelayMs: 1 }),
    /invalid_request/
  );
  assert.strictEqual(calls, 1, '400 ne doit être tenté qu\'une fois');
});

test('withRetry : 429 et 500 → retentés', async () => {
  for (const status of [429, 500]) {
    let calls = 0;
    const err = Object.assign(new Error('e' + status), { status });
    await assert.rejects(
      () => withRetry(() => { calls++; throw err; }, { retries: 2, baseDelayMs: 1 })
    );
    assert.strictEqual(calls, 3, `status ${status} doit être retenté (retries=2 → 3 appels)`);
  }
});

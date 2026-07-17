const { test } = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { averagePng } = require('../scripts/extract-block-colors');

test('moyenne RGB d\'une texture unie', async () => {
  const buf = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } } }).png().toBuffer();
  assert.deepStrictEqual(await averagePng(buf), [200, 100, 50]);
});

test('ignore les pixels transparents', async () => {
  const opaque = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
  const composite = await sharp({ create: { width: 8, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: opaque, left: 0, top: 0 }]).png().toBuffer();
  assert.deepStrictEqual(await averagePng(composite), [10, 20, 30]);
});

test('texture entièrement transparente → null', async () => {
  const buf = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.strictEqual(await averagePng(buf), null);
});

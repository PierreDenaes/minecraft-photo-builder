const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const sharp = require('sharp');
const { estimateDepth, MODEL_PATH } = require('../src/depth');

function fakeSession(rawValues) {
  return {
    inputNames: ['image'],
    outputNames: ['depth'],
    run: async (feeds) => {
      assert.ok(feeds.image.dims.every((d, i) => d === [1, 3, 518, 518][i]));
      return { depth: { data: rawValues } };
    }
  };
}

async function tinyImage() {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } } }).png().toBuffer();
}

test('normalise la disparité en profondeur 0=proche 1=loin', async () => {
  // disparité brute : 10 (loin... non : grand = proche) et 30
  const raw = new Float32Array(518 * 518).fill(10);
  raw[0] = 30; // pixel 0 : le plus proche
  const result = await estimateDepth(await tinyImage(), { session: fakeSession(raw) });
  assert.strictEqual(result.width, 518);
  assert.strictEqual(result.height, 518);
  assert.strictEqual(result.data[0], 0);   // disparité max → proche → 0
  assert.strictEqual(result.data[1], 1);   // disparité min → loin → 1
});

test('erreur claire si le modèle est absent', async () => {
  if (fs.existsSync(MODEL_PATH)) return; // le modèle est installé : cas non testable ici
  await assert.rejects(async () => estimateDepth(await tinyImage()), /setup:depth/);
});

test('intégration réelle (si modèle présent)', async (t) => {
  if (!fs.existsSync(MODEL_PATH)) { t.skip('modèle non installé'); return; }
  const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
  const d = await estimateDepth(img);
  assert.strictEqual(d.data.length, d.width * d.height);
  assert.ok(d.data.every((v) => v >= 0 && v <= 1));
});

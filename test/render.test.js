const { test } = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { renderVoxels } = require('../src/render');

const colors = new Map([['stone', [125, 125, 125]], ['red_concrete', [200, 30, 30]]]);

test('rend un PNG déterministe contenant les couleurs des blocs', async () => {
  const blocks = [
    { x: 0, y: 0, z: 0, block: 'stone' },
    { x: 3, y: 2, z: 1, block: 'red_concrete' }
  ];
  const png1 = await renderVoxels(blocks, colors);
  const png2 = await renderVoxels(blocks, colors);
  assert.ok(Buffer.isBuffer(png1) && png1.length > 100);
  assert.ok(png1.equals(png2));
  const { data, info } = await sharp(png1).raw().toBuffer({ resolveWithObject: true });
  let hasGray = false;
  let hasRed = false;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === 125 && data[i + 1] === 125) hasGray = true;
    if (data[i] === 200 && data[i + 1] === 30) hasRed = true;
  }
  assert.ok(hasGray && hasRed, 'couleurs top absentes du rendu');
});

test('bloc inconnu rendu en gris moyen sans erreur', async () => {
  const png = await renderVoxels([{ x: 0, y: 0, z: 0, block: 'mystere' }], colors);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let found = false;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === 128 && data[i + 1] === 128 && data[i + 2] === 128) found = true;
  }
  assert.ok(found);
});

// === Corrections audit 27/07 (CORRECTIONS-petits-modules.md) ===
test('renderVoxels : lookup couleur sur le nom de base (stairs à états, plus de gris)', async () => {
  const cmap = new Map([['dark_oak_stairs', [60, 40, 20]]]);
  const blocks = [{ x: 0, y: 0, z: 0, block: 'dark_oak_stairs[facing=north,half=bottom]' }];
  const png = await renderVoxels(blocks, cmap, { scale: 2 });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  // au moins un pixel doit porter la couleur dark_oak (pas le gris 128 de repli)
  let found = false;
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    if (Math.abs(data[i] - 60) < 20 && Math.abs(data[i + 1] - 40) < 20 && Math.abs(data[i + 2] - 20) < 20) { found = true; break; }
  }
  assert.ok(found, 'le toit en stairs doit être brun, pas gris 128');
});

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

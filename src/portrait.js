const { nearestBlock } = require('./blockcolors');

// Fresque murale en pixel-art : une image → un mur vertical d'un bloc d'épaisseur.
// Une fresque EST une image : mapping couleur direct sur toute la gamme, sans thèmes.
function portraitBlocks(image, { colors, frame = true, frameBlock = 'dark_oak_planks' } = {}) {
  const off = frame ? 1 : 0;
  const blocks = [];
  for (let py = 0; py < image.height; py++) {
    for (let px = 0; px < image.width; px++) {
      const i = (py * image.width + px) * 3;
      const block = nearestBlock(image.data[i], image.data[i + 1], image.data[i + 2], colors);
      blocks.push({ x: px + off, y: (image.height - 1 - py) + off, z: 0, block });
    }
  }
  if (frame) {
    const W = image.width + 2;
    const H = image.height + 2;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (x === 0 || x === W - 1 || y === 0 || y === H - 1) {
          blocks.push({ x, y, z: 0, block: frameBlock });
        }
      }
    }
  }
  return blocks;
}

module.exports = { portraitBlocks };

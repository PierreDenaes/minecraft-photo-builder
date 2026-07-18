const fs = require('node:fs');
const path = require('node:path');

function loadBlockColors() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/block_colors.json'), 'utf8'));
  return new Map(Object.entries(raw));
}

// Pondération perceptuelle simple (luma)
const W = [0.30, 0.59, 0.11];

function nearestBlock(r, g, b, colors) {
  let best = null;
  let bestDist = Infinity;
  for (const [block, [cr, cg, cb]] of colors) {
    const d = W[0] * (r - cr) ** 2 + W[1] * (g - cg) ** 2 + W[2] * (b - cb) ** 2;
    if (d < bestDist) { bestDist = d; best = block; }
  }
  return best;
}

module.exports = { loadBlockColors, nearestBlock };

// Sous-sol procédural déterministe : strates, cavités, minerais
function hash01(seed, x, y, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// [minerai, probabilité, profondeur min, y max (option)]
const ORE_TABLE = [
  ['coal_ore', 0.012, 3, null],
  ['copper_ore', 0.008, 3, null],
  ['iron_ore', 0.008, 8, null],
  ['gold_ore', 0.0035, 25, null],
  ['redstone_ore', 0.003, 30, null],
  ['lapis_ore', 0.002, 25, null],
  ['diamond_ore', 0.0012, 45, null],
  ['emerald_ore', 0.0006, 45, null]
];

function createUnderground({ seed, maxY }) {
  const deepslateY = Math.floor(maxY * 0.25);

  function isCave(x, y, z, depth) {
    if (depth < 4 || y < 2) return false;
    // poches : cellules 5x4x5 « caveuses » ~18 %, creusées à ~60 % en leur sein
    const cell = hash01(seed ^ 0xCA4E, Math.floor(x / 5), Math.floor(y / 4), Math.floor(z / 5));
    if (cell > 0.18) return false;
    return hash01(seed ^ 0xF055, x, y, z) < 0.6;
  }

  function oreAt(x, y, z, depth) {
    const roll = hash01(seed ^ 0x0FE0, x, y, z);
    let acc = 0;
    for (const [ore, p, minDepth] of ORE_TABLE) {
      if (depth < minDepth) continue;
      acc += p;
      if (roll < acc) return ore;
    }
    return null;
  }

  function fill(x, y, z, depth, surfaceTheme) {
    if (depth <= 2 && (surfaceTheme === 'vegetation' || surfaceTheme === 'terre')) return 'dirt';
    if (depth <= 2) return y < deepslateY ? 'deepslate' : 'stone';
    if (isCave(x, y, z, depth)) return null;
    const deep = y < deepslateY;
    const ore = oreAt(x, y, z, depth);
    if (ore) return deep ? `deepslate_${ore}` : ore;
    return deep ? 'deepslate' : 'stone';
  }

  return { fill };
}

module.exports = { hash01, createUnderground };

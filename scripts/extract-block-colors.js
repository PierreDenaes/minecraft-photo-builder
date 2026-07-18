// Génère data/block_colors.json : moyenne RGB de la texture de chaque bloc de la liste blanche
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const JAR = process.env.MC_JAR ||
  path.join(os.homedir(), 'Library/Application Support/minecraft/versions/1.20.4/1.20.4.jar');
// Certains blocs n'ont pas de texture homonyme : correspondances explicites
const TEXTURE_ALIASES = { grass_block: 'grass_block_top', water: 'water_still', lava: 'lava_still' };

// Textures en niveaux de gris teintées par biome au rendu → appliquer la teinte "plaine"
const BIOME_TINTS = {
  grass_block: [145, 189, 89],
  oak_leaves: [119, 171, 47],
  jungle_leaves: [119, 171, 47],
  acacia_leaves: [119, 171, 47],
  dark_oak_leaves: [119, 171, 47],
  mangrove_leaves: [119, 171, 47],
  spruce_leaves: [97, 153, 97],
  birch_leaves: [128, 167, 85]
};

function applyTint([r, g, b], [tr, tg, tb]) {
  return [Math.round(r * tr / 255), Math.round(g * tg / 255), Math.round(b * tb / 255)];
}

async function averagePng(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] === 0) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (n === 0) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

async function main() {
  if (!fs.existsSync(JAR)) {
    console.error(`jar introuvable : ${JAR}\nInstalle la version 1.20.4 dans le launcher ou définis MC_JAR.`);
    process.exit(1);
  }
  const validBlocks = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/valid_blocks.json'), 'utf8'));
  const colors = {};
  for (const block of validBlocks) {
    if (block === 'air') continue;
    const texture = TEXTURE_ALIASES[block] || block;
    let png;
    try {
      png = execFileSync('unzip', ['-p', JAR, `assets/minecraft/textures/block/${texture}.png`], { maxBuffer: 10 * 1024 * 1024 });
    } catch {
      continue; // pas de texture homonyme (stairs, slabs, portes...) → exclu de la table couleur
    }
    const avg = await averagePng(png);
    if (avg) colors[block] = BIOME_TINTS[block] ? applyTint(avg, BIOME_TINTS[block]) : avg;
  }
  const out = path.join(__dirname, '../data/block_colors.json');
  fs.writeFileSync(out, JSON.stringify(colors, null, 1));
  console.log(`${Object.keys(colors).length} blocs → ${out}`);
}

if (require.main === module) main();
module.exports = { averagePng, applyTint };

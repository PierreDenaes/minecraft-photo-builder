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

// Palettes sémantiques : le mapping couleur ne doit jamais poser un four ou une
// bibliothèque dans un paysage — nature pour le décor, matériaux pour le bâti.
const NATURAL_BLOCKS = new Set([
  'stone', 'cobblestone', 'mossy_cobblestone', 'andesite', 'diorite', 'granite',
  'deepslate', 'cobbled_deepslate', 'tuff', 'calcite', 'dripstone_block', 'blackstone',
  'dirt', 'grass_block', 'sand', 'gravel', 'clay', 'mud', 'packed_mud', 'terracotta',
  'sandstone', 'red_sandstone', 'moss_block', 'snow_block', 'ice', 'packed_ice',
  'water', 'lava',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'dark_oak_leaves', 'acacia_leaves',
  'jungle_leaves', 'mangrove_leaves', 'cherry_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
  'oak_log', 'spruce_log', 'birch_log', 'dark_oak_log', 'acacia_log', 'jungle_log',
  'cherry_log', 'mangrove_log'
]);

const CONSTRUCTION_BLOCKS = new Set([
  'stone', 'cobblestone', 'mossy_cobblestone', 'smooth_stone', 'stone_bricks',
  'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks',
  'andesite', 'polished_andesite', 'diorite', 'polished_diorite', 'granite', 'polished_granite',
  'deepslate', 'cobbled_deepslate', 'deepslate_bricks', 'deepslate_tiles', 'polished_deepslate',
  'blackstone', 'polished_blackstone', 'polished_blackstone_bricks',
  'bricks', 'mud_bricks', 'end_stone_bricks', 'quartz_bricks',
  'sandstone', 'smooth_sandstone', 'cut_sandstone', 'red_sandstone',
  'quartz_block', 'smooth_quartz', 'quartz_pillar', 'chiseled_quartz_block',
  'oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks', 'acacia_planks',
  'jungle_planks', 'mangrove_planks', 'cherry_planks', 'crimson_planks', 'warped_planks',
  'oak_log', 'spruce_log', 'birch_log', 'dark_oak_log', 'acacia_log', 'jungle_log',
  'cherry_log', 'mangrove_log', 'stripped_oak_log', 'stripped_spruce_log',
  'stripped_dark_oak_log', 'stripped_birch_log', 'stripped_acacia_log',
  'white_concrete', 'gray_concrete', 'light_gray_concrete', 'black_concrete',
  'red_concrete', 'blue_concrete', 'green_concrete', 'yellow_concrete', 'orange_concrete',
  'brown_concrete', 'purple_concrete', 'pink_concrete', 'cyan_concrete',
  'light_blue_concrete', 'lime_concrete', 'magenta_concrete',
  'white_terracotta', 'red_terracotta', 'orange_terracotta', 'yellow_terracotta',
  'brown_terracotta', 'green_terracotta', 'blue_terracotta', 'gray_terracotta',
  'light_gray_terracotta', 'black_terracotta', 'cyan_terracotta', 'terracotta',
  'white_wool', 'gray_wool', 'light_gray_wool', 'black_wool', 'red_wool', 'blue_wool',
  'green_wool', 'yellow_wool', 'brown_wool', 'orange_wool',
  'glass', 'glass_pane', 'tinted_glass', 'iron_block', 'iron_bars',
  'copper_block', 'cut_copper', 'oxidized_copper',
  'prismarine', 'prismarine_bricks', 'dark_prismarine'
]);

// Thèmes de matière : le choix délibéré se fait au niveau du thème, mais chaque
// thème conserve TOUS ses blocs pour les nuances de couleur.
const THEME_BLOCKS = {
  roche: new Set(['stone', 'cobblestone', 'mossy_cobblestone', 'smooth_stone', 'andesite',
    'polished_andesite', 'diorite', 'granite', 'deepslate', 'cobbled_deepslate', 'tuff',
    'calcite', 'dripstone_block', 'blackstone']),
  terre: new Set(['dirt', 'mud', 'packed_mud', 'clay', 'terracotta', 'brown_terracotta', 'gravel']),
  vegetation: new Set(['grass_block', 'moss_block', 'oak_leaves', 'spruce_leaves', 'birch_leaves',
    'dark_oak_leaves', 'acacia_leaves', 'jungle_leaves', 'mangrove_leaves', 'cherry_leaves',
    'azalea_leaves', 'flowering_azalea_leaves']),
  bois: new Set(['oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks', 'acacia_planks',
    'jungle_planks', 'mangrove_planks', 'cherry_planks', 'crimson_planks', 'warped_planks',
    'oak_log', 'spruce_log', 'birch_log', 'dark_oak_log', 'acacia_log', 'jungle_log',
    'cherry_log', 'mangrove_log', 'stripped_oak_log', 'stripped_spruce_log',
    'stripped_dark_oak_log', 'stripped_birch_log', 'stripped_acacia_log']),
  maconnerie: new Set(['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
    'chiseled_stone_bricks', 'bricks', 'mud_bricks', 'deepslate_bricks', 'deepslate_tiles',
    'polished_deepslate', 'polished_blackstone', 'polished_blackstone_bricks', 'polished_granite',
    'polished_diorite', 'end_stone_bricks', 'quartz_bricks', 'quartz_block', 'smooth_quartz',
    'quartz_pillar', 'chiseled_quartz_block', 'prismarine', 'prismarine_bricks', 'dark_prismarine']),
  sable: new Set(['sand', 'sandstone', 'smooth_sandstone', 'cut_sandstone', 'red_sandstone']),
  neige_glace: new Set(['snow_block', 'ice', 'packed_ice', 'calcite']),
  eau: new Set(['water']),
  couleurs_vives: new Set(['white_concrete', 'gray_concrete', 'light_gray_concrete', 'black_concrete',
    'red_concrete', 'blue_concrete', 'green_concrete', 'yellow_concrete', 'orange_concrete',
    'brown_concrete', 'purple_concrete', 'pink_concrete', 'cyan_concrete', 'light_blue_concrete',
    'lime_concrete', 'magenta_concrete', 'white_wool', 'gray_wool', 'light_gray_wool', 'black_wool',
    'red_wool', 'blue_wool', 'green_wool', 'yellow_wool', 'brown_wool', 'orange_wool',
    'white_terracotta', 'red_terracotta', 'orange_terracotta', 'yellow_terracotta',
    'green_terracotta', 'blue_terracotta', 'gray_terracotta', 'light_gray_terracotta',
    'black_terracotta', 'cyan_terracotta']),
  metal: new Set(['iron_block', 'iron_bars', 'copper_block', 'cut_copper', 'oxidized_copper'])
};

function filterColors(colors, names) {
  const out = new Map();
  for (const [block, rgb] of colors) {
    if (names.has(block)) out.set(block, rgb);
  }
  return out;
}

module.exports = { loadBlockColors, nearestBlock, filterColors, NATURAL_BLOCKS, CONSTRUCTION_BLOCKS, THEME_BLOCKS };

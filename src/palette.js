const { withRetry, stripCodeFences } = require('./llm');
const { nearestBlock, filterColors, THEME_BLOCKS } = require('./blockcolors');

const MODEL = 'claude-sonnet-4-6';

// K-means déterministe : init par luminance triée, 12 itérations, clusters vides éliminés
function clusterColors(samples, k) {
  if (samples.length === 0) return [];
  const kk = Math.min(k, samples.length);
  const sorted = [...samples].sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  let centroids = Array.from({ length: kk }, (_, i) => [
    ...sorted[Math.floor((i * (sorted.length - 1)) / Math.max(1, kk - 1))]
  ]);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = (s[0] - centroids[c][0]) ** 2 + (s[1] - centroids[c][1]) ** 2 + (s[2] - centroids[c][2]) ** 2;
        if (d < bd) { bd = d; bi = c; }
      }
      sums[bi][0] += s[0]; sums[bi][1] += s[1]; sums[bi][2] += s[2]; sums[bi][3]++;
    }
    centroids = sums.filter((s) => s[3] > 0).map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
  }
  return centroids.map((c) => c.map(Math.round));
}

// Choix DÉLIBÉRÉ d'un bloc par famille de couleurs : le LLM décide sémantiquement,
// repli plus-proche-voisin si indisponible ou choix hors liste
async function assignBlocks(centroids, allowedColors, { client, contexte } = {}) {
  const fallback = () => centroids.map((c) => nearestBlock(c[0], c[1], c[2], allowedColors));
  if (!client || centroids.length === 0) return fallback();
  try {
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: `Tu es un maître bâtisseur Minecraft. Pour chaque couleur dominante RGB d'une scène, choisis LE bloc le plus approprié SÉMANTIQUEMENT : roche/falaise → pierres (stone, tuff, andesite...), végétation → feuilles ou grass_block, terre/chemin → dirt/gravel, murs → maçonnerie cohérente, bois → planches ou troncs. Jamais un bloc incongru pour la matière représentée. Réponds UNIQUEMENT en JSON strict : [{"rgb":[r,g,b],"bloc":"nom"}], dans le même ordre que les couleurs fournies.`,
      messages: [{
        role: 'user',
        content: `Contexte : ${contexte || 'scène extérieure'}\nBlocs autorisés (aucun autre) : ${[...allowedColors.keys()].join(', ')}\nCouleurs dominantes : ${JSON.stringify(centroids)}`
      }]
    }), { retries: 1 });
    const parsed = JSON.parse(stripCodeFences(response.content.find((b) => b.type === 'text').text));
    return centroids.map((c, i) => {
      const bloc = parsed[i]?.bloc;
      return allowedColors.has(bloc) ? bloc : nearestBlock(c[0], c[1], c[2], allowedColors);
    });
  } catch (err) {
    console.warn('[palette] choix LLM indisponible, repli plus-proche-voisin :', err.message);
    return fallback();
  }
}

// Map bloc→centroïde : passée aux voxeliseurs, elle contraint tout le rendu aux blocs choisis
function buildPaletteMap(centroids, blocks) {
  const map = new Map();
  for (let i = 0; i < blocks.length; i++) {
    if (!map.has(blocks[i])) map.set(blocks[i], centroids[i]);
  }
  return map;
}

function themeOfBlock(block) {
  for (const [theme, set] of Object.entries(THEME_BLOCKS)) {
    if (set.has(block)) return theme;
  }
  return null;
}

// Choix délibéré au niveau du THÈME : le LLM décide de la matière de chaque famille
// de couleurs, le rendu garde ensuite tous les blocs du thème pour les nuances
async function assignThemes(centroids, allowedColors, { client, contexte } = {}) {
  const fallback = () => centroids.map((c) => themeOfBlock(nearestBlock(c[0], c[1], c[2], allowedColors)) || 'roche');
  if (!client || centroids.length === 0) return fallback();
  try {
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: `Tu es un maître bâtisseur Minecraft. Pour chaque couleur dominante RGB d'une scène, identifie LA MATIÈRE représentée et choisis son thème : roche (falaises, pierre brute), terre (sols, chemins), vegetation (herbe, feuillages), bois (charpentes, troncs), maconnerie (murs bâtis, briques), sable, neige_glace, eau, couleurs_vives (enduits, toits colorés, objets peints), metal. Réponds UNIQUEMENT en JSON strict : [{"rgb":[r,g,b],"theme":"nom"}], dans le même ordre que les couleurs fournies.`,
      messages: [{
        role: 'user',
        content: `Contexte : ${contexte || 'scène extérieure'}\nThèmes possibles : ${Object.keys(THEME_BLOCKS).join(', ')}\nCouleurs dominantes : ${JSON.stringify(centroids)}`
      }]
    }), { retries: 1 });
    const parsed = JSON.parse(stripCodeFences(response.content.find((b) => b.type === 'text').text));
    const fb = fallback();
    return centroids.map((c, i) => (THEME_BLOCKS[parsed[i]?.theme] ? parsed[i].theme : fb[i]));
  } catch (err) {
    console.warn('[palette] choix de thèmes LLM indisponible, repli :', err.message);
    return fallback();
  }
}

// Retourne une fonction (r,g,b) → bloc : thème du centroïde le plus proche,
// puis plus proche voisin parmi TOUS les blocs de ce thème
function buildThemePicker(centroids, themes, allowedColors) {
  const themeMaps = themes.map((t) => filterColors(allowedColors, THEME_BLOCKS[t] || new Set()));
  return (r, g, b) => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      const d = (r - centroids[i][0]) ** 2 + (g - centroids[i][1]) ** 2 + (b - centroids[i][2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const m = themeMaps[bi];
    return m.size > 0 ? nearestBlock(r, g, b, m) : nearestBlock(r, g, b, allowedColors);
  };
}

module.exports = { clusterColors, assignBlocks, buildPaletteMap, assignThemes, buildThemePicker, themeOfBlock };

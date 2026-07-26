// Génère data/schema-catalog.json depuis data/schem-refs.json en devinant
// type_batiment et tags par heuristique sur les dimensions et matériaux.
// Le catalogue enrichi sert au sélecteur de src/schemas.js.

const fs = require('node:fs');
const path = require('node:path');

const IN = path.join(__dirname, '..', 'data', 'schem-refs.json');
const OUT = path.join(__dirname, '..', 'data', 'schema-catalog.json');

function guessType(dims, style) {
  const vol = dims.x * dims.y * dims.z;
  const w = Math.max(dims.x, dims.z); // emprise au sol
  const h = dims.y;
  if (vol > 40000) return 'manoir';
  if (w > 30) return 'manoir';
  if (h > 25 && w < 25) return 'tour';
  if (style === 'moderne' && w >= 18) return 'villa';
  return 'maison';
}

function guessTags(ref) {
  const tags = [ref.style];
  const vol = ref.dims.x * ref.dims.y * ref.dims.z;
  if (vol < 8000) tags.push('petit');
  else if (vol > 30000) tags.push('grand');
  else tags.push('moyen');
  const mats = ref.top_materiaux.join(' ');
  if (/concrete/.test(mats)) tags.push('beton');
  if (/quartz|calcite|basalt/.test(mats)) tags.push('pierre_taillee');
  if (/planks|log/.test(mats)) tags.push('bois');
  if (/glass/.test(mats)) tags.push('vitre');
  if (/mushroom|packed_mud/.test(mats)) tags.push('champignon');
  if (/stone_bricks|cobblestone/.test(mats)) tags.push('pierre');
  if (ref.ratios.stairs >= 2) tags.push('detaille');
  return tags;
}

// Blocs d'environnement — jamais des matériaux « murs / accent / toit »
const ENV = new Set(['air', 'dirt', 'grass_block', 'coarse_dirt', 'gravel', 'sand',
  'water', 'lava', 'short_grass', 'tall_grass', 'grass', 'fern', 'dandelion',
  'poppy', 'snow', 'snow_block', 'ice', 'packed_ice', 'moss_block']);

function extractMateriauxBase(topMateriaux) {
  const clean = topMateriaux
    .map((s) => s.replace(/\([^)]+\)/, ''))
    .filter((n) => !ENV.has(n));
  return {
    murs_principaux: clean[0] || 'stone_bricks',
    accent: clean[1] || clean[0] || 'stone',
    toit: clean[2] || clean[0] || 'dark_oak_planks',
    tous: clean
  };
}

const refs = JSON.parse(fs.readFileSync(IN, 'utf8'));
const catalog = refs.map((r) => ({
  nom: r.nom,
  fichier: r.fichier,
  style: r.style,
  type_batiment: guessType(r.dims, r.style),
  emprise: r.dims,
  tags: guessTags(r),
  materiaux_base: extractMateriauxBase(r.top_materiaux)
}));

fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`[catalog] ${catalog.length} entrée(s) écrites`);
// résumé par type
const byType = {};
for (const e of catalog) (byType[e.type_batiment] ||= []).push(e.style);
for (const [t, styles] of Object.entries(byType)) console.log(`  ${t}: ${styles.length} (${[...new Set(styles)].join(', ')})`);

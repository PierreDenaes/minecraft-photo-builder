const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { loadSchematic } = require('@enginehub/schematicjs');
const nbt = require('@enginehub/nbt-ts');

// Filtre défensif : les schemas contiennent parfois des blocs 1.21+, snapshot
// ou mods qu'on n'a pas whitelistés. On les remplace par air plutôt que faire
// échouer toute la construction.
let VALID_BLOCKS = null;
function loadValid() {
  if (VALID_BLOCKS) return VALID_BLOCKS;
  try { VALID_BLOCKS = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'valid_blocks.json'), 'utf8'))); }
  catch { VALID_BLOCKS = new Set(); }
  return VALID_BLOCKS;
}

// nbt-ts retourne un plain object mais schematicjs attend un Map récursif.
function toMap(v) {
  if (v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Buffer) && !Array.isArray(v) && !ArrayBuffer.isView(v)) {
    if ('value' in v && Object.keys(v).length <= 2) return v; // Byte/Short/Int/Long/Float boxed
    const m = new Map();
    for (const [k, val] of Object.entries(v)) m.set(k, toMap(val));
    return m;
  }
  if (Array.isArray(v)) return v.map(toMap);
  return v;
}

// Catalogue : schemas indexés avec style, type_batiment, emprise, tags.
// Chargé une fois au démarrage — voir data/schema-catalog.json.
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'schema-catalog.json');
const SCHEM_DIR = path.join(__dirname, '..', 'docs', 'schem');

let CATALOG = null;
function loadCatalog() {
  if (CATALOG) return CATALOG;
  try { CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); }
  catch { CATALOG = []; }
  return CATALOG;
}

function listCatalog() {
  return loadCatalog();
}

// Charge un .schem via prismarine-schematic et matérialise chaque bloc non-air
// dans [{x, y, z, block}]. Coordonnées normalisées à l'origine (0,0,0).
async function loadSchema(nom) {
  const catalog = loadCatalog();
  const entry = catalog.find((e) => e.nom === nom);
  if (!entry) throw new Error(`schema inconnu du catalogue : ${nom}`);
  const filePath = path.join(SCHEM_DIR, entry.fichier);
  if (!fs.existsSync(filePath)) throw new Error(`schema ${nom} : fichier manquant (${filePath})`);
  let raw = fs.readFileSync(filePath);
  try { raw = zlib.gunzipSync(raw); } catch { /* déjà décompressé */ }
  const { value } = nbt.decode(raw);
  const s = loadSchematic(toMap(value));
  const valid = loadValid();
  const blocks = [];
  const palette = new Set();
  const unknown = new Set();
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      for (let z = 0; z < s.length; z++) {
        const b = s.getBlock({ x, y, z });
        if (!b) continue;
        const name = b.type.replace(/^minecraft:/, '');
        if (name === 'air' || name === 'cave_air' || name === 'void_air') continue;
        if (valid.size > 0 && !valid.has(name)) { unknown.add(name); continue; }
        blocks.push({ x, y, z, block: name });
        palette.add(name);
      }
    }
  }
  if (unknown.size > 0) console.warn(`[schema ${entry.nom}] ${unknown.size} bloc(s) inconnu(s) ignoré(s) : ${[...unknown].slice(0, 5).join(', ')}...`);

  // Retire le TERRAIN qui déborde de l'emprise du bâtiment. Beaucoup de schemas
  // sont exportés avec leur sol (dirt/grass_block) qui s'étend au-delà de la
  // maison → énorme socle en jeu.
  const GROUND = /^(dirt|grass_block|coarse_dirt|podzol|farmland|dirt_path|rooted_dirt|gravel|mycelium)$/;
  const STRUCT_START_Y = 3; // au-delà de 3 blocs au-dessus du sol = structure
  if (blocks.length > 0) {
    const minY = Math.min(...blocks.map((b) => b.y));
    // emprise du bâtiment = colonnes (x,z) qui portent au moins un bloc de STRUCTURE
    const structXZ = new Set();
    for (const b of blocks) {
      if (b.y >= minY + STRUCT_START_Y && !GROUND.test(b.block)) structXZ.add(`${b.x},${b.z}`);
    }
    if (structXZ.size > 0) {
      const filtered = blocks.filter((b) => {
        if (!GROUND.test(b.block)) return true;
        // garde le terrain seulement sous les colonnes de structure
        return structXZ.has(`${b.x},${b.z}`);
      });
      const removed = blocks.length - filtered.length;
      if (removed > 0) console.log(`[schema ${entry.nom}] socle retiré : ${removed} bloc(s) de terrain hors emprise`);
      blocks.length = 0;
      blocks.push(...filtered);
    }
  }
  return {
    nom: entry.nom,
    style: entry.style,
    type_batiment: entry.type_batiment,
    dims: { x: s.width, y: s.height, z: s.length },
    blocks,
    palette
  };
}

// Remplace le nom de base de chaque bloc selon la table mapping ; préserve
// les états entre crochets ([facing=...], [half=...]).
function remapPalette(schema, mapping) {
  const blocks = schema.blocks.map((b) => {
    const m = /^([a-z_0-9]+)(\[[^\]]*\])?$/.exec(b.block);
    if (!m) return b;
    const base = m[1];
    const state = m[2] || '';
    if (!(base in mapping)) return b;
    return { ...b, block: mapping[base] + state };
  });
  return { ...schema, blocks };
}

// STRICT : on ne propose que si un schema matche vraiment. Ordre de priorité :
// 1. type_batiment exact + style exact
// 2. type_batiment exact (peu importe le style)
// 3. style exact (peu importe le type)
// 4. null (aucun match → l'appelant décide d'afficher une erreur claire)
async function chooseSchema(description) {
  const catalog = loadCatalog();
  if (catalog.length === 0) return null;
  const type = (description.type_batiment || '').toLowerCase();
  const style = (description.style || '').toLowerCase();
  // Matching tolérant : chaque type du catalogue matche si son mot-clé apparaît
  // dans le type libre de la vision ("maison_bretonne_en_pierre" → "maison")
  const typeKeywords = {
    villa: ['villa'],
    maison: ['maison', 'chaumiere', 'cottage'],
    manoir: ['manoir', 'chateau', 'demeure', 'ferme', 'batisse'],
    tour: ['tour', 'phare', 'donjon']
  };
  const matchType = (schemaType) => {
    if (schemaType === type) return true;
    const kws = typeKeywords[schemaType] || [schemaType];
    return kws.some((kw) => type.includes(kw));
  };
  // Priorité 1 : type + style
  let match = catalog.find((e) => matchType(e.type_batiment) && e.style === style);
  if (match) return match;
  // Priorité 2 : type seulement
  match = catalog.find((e) => matchType(e.type_batiment));
  if (match && catalog.some((e) => e.style === style)) return match;
  // Priorité 3 : style seulement (donne au moins un style cohérent)
  match = catalog.find((e) => e.style === style);
  if (match) return match;
  // Aucun match convaincant
  return null;
}

// Retourne jusqu'à n schemas triés par pertinence — style_exact_et_type >
// type_exact > style_exact. Utilisé par le mode RAG (I18) qui passe 2-3 exemples
// au LLM plutôt qu'un seul.
async function chooseSchemas(description, n = 3) {
  const catalog = loadCatalog();
  if (catalog.length === 0) return [];
  const type = (description.type_batiment || '').toLowerCase();
  const style = (description.style || '').toLowerCase();
  const typeKeywords = {
    villa: ['villa'],
    maison: ['maison', 'chaumiere', 'cottage'],
    manoir: ['manoir', 'chateau', 'demeure', 'ferme', 'batisse'],
    tour: ['tour', 'phare', 'donjon']
  };
  const matchType = (schemaType) => {
    if (schemaType === type) return true;
    const kws = typeKeywords[schemaType] || [schemaType];
    return kws.some((kw) => type.includes(kw));
  };
  const scored = catalog.map((e) => {
    let score = 0;
    if (e.style === style) score += 10;
    if (matchType(e.type_batiment)) score += 5;
    return { entry: e, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => s.entry);
}

// Analyse UN schema pour extraire proportions et matériaux par zone verticale
// (fondation = 0-30% de h, murs = 30-70%, toit = 70-100%). Utilisé par le
// mode RAG pour nourrir le LLM d'exemples concrets.
async function analyzeSchema(entry) {
  const full = await loadSchema(entry.nom);
  const h = full.dims.y;
  const yBoundLow = Math.max(1, Math.floor(h * 0.3));
  const yBoundHigh = Math.max(yBoundLow + 1, Math.floor(h * 0.7));
  const zones = { fondation: new Map(), murs: new Map(), toit: new Map() };
  for (const b of full.blocks) {
    const zone = b.y < yBoundLow ? 'fondation' : b.y < yBoundHigh ? 'murs' : 'toit';
    const map = zones[zone];
    map.set(b.block, (map.get(b.block) || 0) + 1);
  }
  const topOfZone = (map) => {
    const total = [...map.values()].reduce((a, c) => a + c, 0);
    if (total === 0) return [];
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([bloc, count]) => ({ bloc, pct: Math.round((count / total) * 100) }));
  };
  const refInfo = require('../data/schem-refs.json').find((r) => r.nom === entry.nom) || {};
  return {
    nom: entry.nom,
    style: entry.style,
    type_batiment: entry.type_batiment,
    proportions: {
      largeur: full.dims.x,
      profondeur: full.dims.z,
      hauteur: full.dims.y,
      ratio_h_l: Math.round((full.dims.y / Math.max(full.dims.x, full.dims.z)) * 100) / 100
    },
    materiaux_par_zone: {
      fondation: topOfZone(zones.fondation),
      murs: topOfZone(zones.murs),
      toit: topOfZone(zones.toit)
    },
    ratios: refInfo.ratios || { stairs: 0, glass: 0, torches: 0 }
  };
}

module.exports = { loadSchema, remapPalette, chooseSchema, chooseSchemas, analyzeSchema, listCatalog };

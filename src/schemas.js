const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { loadSchematic } = require('@enginehub/schematicjs');
const nbt = require('@enginehub/nbt-ts');

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
  const blocks = [];
  const palette = new Set();
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      for (let z = 0; z < s.length; z++) {
        const b = s.getBlock({ x, y, z });
        if (!b || b.type === 'minecraft:air') continue;
        const name = b.type.replace(/^minecraft:/, '');
        blocks.push({ x, y, z, block: name });
        palette.add(name);
      }
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

module.exports = { loadSchema, remapPalette, chooseSchema, listCatalog };

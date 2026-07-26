const { loadSchematic } = require('@enginehub/schematicjs');
const nbt = require('@enginehub/nbt-ts');
const zlib = require('zlib');
const fs = require('node:fs');
const path = require('node:path');

// Extrait par schema : dims, matériaux dominants, ratios, style deviné.
// Utilise @enginehub/schematicjs (support Sponge v1/v2/v3 + MCEdit), là où
// prismarine-schematic ne lisait que v2. Le NBT vient de @enginehub/nbt-ts.

const SCHEM_DIR = path.join(__dirname, '../docs/schem');
const OUT = path.join(__dirname, '../data/schem-refs.json');

// Convertit récursivement un plain object NBT en Map (attendu par schematicjs)
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

function guessStyle(top) {
  const s = top.join(' ');
  if (/white_concrete|black_stained_glass|deepslate_tile/.test(s)) return 'moderne';
  if (/quartz|smooth_basalt|calcite/.test(s)) return 'moderne';
  if (/packed_mud|jungle|brown_mushroom|stripped/.test(s)) return 'rustique_organique';
  if (/stone_bricks|cobblestone|dark_oak_log/.test(s)) return 'medieval';
  if (/sandstone|smooth_sandstone|terracotta/.test(s)) return 'desert';
  return 'autre';
}

async function extractOne(file) {
  let raw;
  try { raw = fs.readFileSync(path.join(SCHEM_DIR, file)); }
  catch { return null; }
  try { raw = zlib.gunzipSync(raw); } catch { /* déjà décompressé */ }
  let value;
  try { ({ value } = nbt.decode(raw)); } catch { return null; }
  let s;
  try { s = loadSchematic(toMap(value)); } catch { return null; }
  const counts = new Map();
  let stairs = 0, glass = 0, torches = 0, total = 0;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) for (let z = 0; z < s.length; z++) {
    const b = s.getBlock({ x, y, z });
    if (!b) continue;
    const name = b.type.replace(/^minecraft:/, '');
    if (name === 'air' || name === 'cave_air' || name === 'void_air') continue;
    counts.set(name, (counts.get(name) || 0) + 1);
    total++;
    if (/_stairs/.test(name)) stairs++;
    if (/glass/.test(name)) glass++;
    if (/torch|lantern/.test(name)) torches++;
  }
  if (total === 0) return null;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    nom: file.replace(/\.schem$/, ''),
    fichier: file,
    dims: { x: s.width, y: s.height, z: s.length },
    total_blocs: total,
    top_materiaux: top.map(([n, c]) => `${n}(${Math.round(100 * c / total)}%)`),
    ratios: {
      stairs: +(100 * stairs / total).toFixed(1),
      glass: +(100 * glass / total).toFixed(1),
      torches: +(100 * torches / total).toFixed(2)
    },
    style: guessStyle(top.map(([n]) => n))
  };
}

(async () => {
  const files = fs.readdirSync(SCHEM_DIR)
    .filter((f) => f.endsWith('.schem') && !/ \(\d+\)\.schem$/.test(f));
  const refs = [];
  for (const f of files) {
    const r = await extractOne(f);
    if (!r) { console.warn(`[schem] ${f} illisible ou vide — ignoré`); continue; }
    // écarte les monstres (>200 blocs de côté = scène entière, pas un bâtiment isolé)
    if (Math.max(r.dims.x, r.dims.y, r.dims.z) > 200) {
      console.warn(`[schem] ${f} trop grand (${r.dims.x}×${r.dims.y}×${r.dims.z}) — ignoré`);
      continue;
    }
    // écarte les nains (< 500 blocs OU un côté ≤ 3) — pas un vrai bâtiment
    if (r.total_blocs < 500 || Math.min(r.dims.x, r.dims.y, r.dims.z) <= 3) {
      console.warn(`[schem] ${f} trop petit (${r.dims.x}×${r.dims.y}×${r.dims.z}, ${r.total_blocs} blocs) — ignoré`);
      continue;
    }
    refs.push(r);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(refs, null, 2) + '\n');
  console.log(`[schem] ${refs.length} référence(s) écrite(s) dans ${OUT}`);
})();

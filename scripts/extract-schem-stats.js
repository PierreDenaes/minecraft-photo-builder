const { Schematic } = require('prismarine-schematic');
const Vec3 = require('vec3');
const fs = require('node:fs');
const path = require('node:path');

// Extrait par schema : nom, dims, matériaux dominants, ratios structurels.
// Le prompt utilise ces stats pour donner au LLM le VOCABULAIRE des styles réels
// (« manoir organique : granite + jungle_planks + stripped_jungle_wood, stairs 5%+ »).

const SCHEM_DIR = path.join(__dirname, '../docs/schem');
const OUT = path.join(__dirname, '../data/schem-refs.json');

async function extractOne(file) {
  const buf = fs.readFileSync(path.join(SCHEM_DIR, file));
  let s;
  try { s = await Schematic.read(buf, '1.20.4'); } catch { return null; }
  const counts = new Map();
  let stairs = 0, doors = 0, glass = 0, water = 0, torches = 0, total = 0;
  for (let y = 0; y < s.size.y; y++) for (let x = 0; x < s.size.x; x++) for (let z = 0; z < s.size.z; z++) {
    const b = await s.getBlock(new Vec3(x, y, z));
    if (!b || b.name === 'air') continue;
    counts.set(b.name, (counts.get(b.name) || 0) + 1);
    total++;
    if (/_stairs/.test(b.name)) stairs++;
    if (/_door/.test(b.name)) doors++;
    if (/glass/.test(b.name)) glass++;
    if (b.name === 'water') water++;
    if (/torch|lantern/.test(b.name)) torches++;
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    nom: file.replace(/\.schem$/, ''),
    dims: { x: s.size.x, y: s.size.y, z: s.size.z },
    total_blocs: total,
    top_materiaux: top.map(([n, c]) => `${n}(${Math.round(100 * c / total)}%)`),
    ratios: {
      stairs: +(100 * stairs / total).toFixed(1),
      glass: +(100 * glass / total).toFixed(1),
      torches: +(100 * torches / total).toFixed(2)
    }
  };
}

// Devine un style-clé à partir des matériaux dominants
function guessStyle(top) {
  const s = top.join(' ');
  if (/white_concrete|black_stained_glass|deepslate_tile/.test(s)) return 'moderne';
  if (/packed_mud|jungle|brown_mushroom|stripped/.test(s)) return 'rustique_organique';
  if (/stone_bricks|cobblestone|dark_oak_log/.test(s)) return 'medieval';
  if (/sandstone|smooth_sandstone|terracotta/.test(s)) return 'desert';
  return 'autre';
}

(async () => {
  const files = fs.readdirSync(SCHEM_DIR).filter((f) => f.endsWith('.schem'));
  const refs = [];
  for (const f of files) {
    const r = await extractOne(f);
    if (!r) { console.warn(`[schem] ${f} illisible — ignoré`); continue; }
    if (r.total_blocs === 0) { console.warn(`[schem] ${f} vide (palette non lue) — ignoré`); continue; }
    r.style = guessStyle(r.top_materiaux);
    refs.push(r);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(refs, null, 2) + '\n');
  console.log(`[schem] ${refs.length} référence(s) écrite(s) dans ${OUT}`);
})();

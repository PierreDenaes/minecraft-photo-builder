const { withRetry, stripCodeFences } = require('./llm');
const { runStructureCode } = require('./generator');
const { INTERIOR_BLOCKS } = require('./blockcolors');

const MODEL = 'claude-sonnet-4-6';

function dimsOf(blocks) {
  const d = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    d.x = Math.max(d.x, b.x + 1);
    d.y = Math.max(d.y, b.y + 1);
    d.z = Math.max(d.z, b.z + 1);
  }
  return d;
}

function detectFloors(building) {
  if (building.length === 0) return [];
  const d = dimsOf(building);
  const occ = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const perY = new Map();
  for (const b of building) {
    // un plancher est une surface de MARCHE : bloc avec de l'air au-dessus
    // (sinon les anneaux de murs des petits bâtiments comptent comme étages)
    if (occ.has(`${b.x},${b.y + 1},${b.z}`)) continue;
    perY.set(b.y, (perY.get(b.y) || 0) + 1);
  }
  const footprint = d.x * d.z;
  const floors = [];
  for (let y = 0; y < d.y; y++) {
    if ((perY.get(y) || 0) >= footprint * 0.3) {
      if (floors.length === 0 || y - floors[floors.length - 1] >= 3) floors.push(y);
    }
  }
  return floors;
}

// Physique des attachements Minecraft : une torche debout exige un bloc plein
// DESSOUS, au mur c'est wall_torch avec orientation, sinon l'objet saute à la pose
const NEEDS_FLOOR = new Set(['torch', 'lantern', 'campfire', 'flower_pot']);
const ATTACH_FACINGS = [['east', -1, 0], ['west', 1, 0], ['south', 0, -1], ['north', 0, 1]];
const SOLID_DECOR = new Set(['bookshelf', 'crafting_table', 'furnace', 'smoker', 'barrel', 'glowstone',
  'sea_lantern', 'hay_block', 'white_wool', 'red_wool', 'blue_wool', 'green_wool', 'yellow_wool',
  'brown_wool', 'black_wool']);

const baseOf = (n) => n.replace(/\[[^\]]*\]$/, '');
const BED_HEAD = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

function fixAttachments(items, isSolid) {
  const keptSolid = new Set();
  const solidAt = (x, y, z) => isSolid(x, y, z) || keptSolid.has(`${x},${y},${z}`);
  const kept = [];
  for (const b of [...items].sort((p, q) => p.y - q.y)) {
    const base = baseOf(b.block);
    const below = solidAt(b.x, b.y - 1, b.z);
    const lateral = ATTACH_FACINGS.find(([, dx, dz]) => solidAt(b.x + dx, b.y, b.z + dz));
    let block = b.block;
    if (base === 'torch' || base === 'wall_torch') {
      // l'orientation fournie par le LLM est ignorée : recalculée d'après le mur réel
      if (base === 'torch' && below) block = 'torch';
      else if (lateral) block = `wall_torch[facing=${lateral[0]}]`;
      else if (below) block = 'torch';
      else continue;
    } else if (base.endsWith('_bed')) {
      if (/part=head/.test(b.block)) continue; // la tête est régénérée depuis le pied
      if (!below) continue;
      const facing = (/facing=(north|south|east|west)/.exec(b.block) || [, 'north'])[1];
      const [dx, dz] = BED_HEAD[facing];
      kept.push({ x: b.x, y: b.y, z: b.z, block: `${base}[facing=${facing},part=foot]` });
      kept.push({ x: b.x + dx, y: b.y, z: b.z + dz, block: `${base}[facing=${facing},part=head]` });
      continue;
    } else if (NEEDS_FLOOR.has(base)) {
      if (!below) continue;
    } else if (base === 'ladder') {
      if (!lateral) continue;
      block = `ladder[facing=${lateral[0]}]`;
    }
    if (SOLID_DECOR.has(base)) keptSolid.add(`${b.x},${b.y},${b.z}`);
    kept.push(block === b.block ? b : { ...b, block });
  }
  return kept;
}

// Carte d'un plancher au niveau de marche (y+1) : # mur, . sol libre, espace = vide
function floorMap(occupied, fy, d) {
  const rows = [];
  for (let z = 0; z < d.z; z++) {
    let row = '';
    for (let x = 0; x < d.x; x++) {
      if (occupied.has(`${x},${fy + 1},${z}`)) row += '#';
      else if (occupied.has(`${x},${fy},${z}`)) row += '.';
      else row += ' ';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

async function decorateInterior(building, description, { client, timeoutMs = 20000 } = {}) {
  const floors = detectFloors(building);
  if (!client || floors.length === 0) return [];
  const d = dimsOf(building);
  const occupied = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const cartes = floors
    .map((fy) => `Plancher y=${fy} (pose les meubles à y=${fy + 1}) — carte (# mur, . sol libre, espace = vide ; 1 ligne = z croissant, 1 colonne = x) :\n${floorMap(occupied, fy, d)}`)
    .join('\n\n');
  try {
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      temperature: 0.3,
      system: [{ type: 'text', text: `Tu es décorateur d'intérieur Minecraft (version 1.20). Écris une fonction JavaScript pure generateStructure() retournant [{x, y, z, block}].
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown. Termine par le commentaire exact : // FIN_STRUCTURE

Placement :
- Mobilier, rangements et éclairage posés SUR les planchers (y du plancher + 1), à l'intérieur des murs (marge de 1 bloc)
- Les cartes ASCII fournies donnent, pour chaque plancher, la vue de dessus : chaque ligne = z croissant vers le bas, chaque colonne = x croissant vers la droite ; le y du plancher est indiqué en en-tête de chaque carte
- "#" = mur, "." = sol libre, espace = vide. Pose UNIQUEMENT sur des cases ".", les meubles et l'éclairage CONTRE les murs "#", jamais sur "#" ni dans le vide

Circulation (obligatoire) :
- Ne pose RIEN sur les cases d'escalier ni sur les 2 cases devant chaque porte ou ouverture
- Laisse un chemin libre d'au moins 1 case de large entre chaque porte et chaque escalier de l'étage

Cohérence :
- Pièces cohérentes avec le type et le style du bâtiment fournis : coin repas, bibliothèque, atelier, chambre... adapte le mobilier au contexte (une chapelle n'a pas de lit, une forge a des fourneaux)
- Éclairage régulier contre les murs
- PARCIMONIE : 10 à 20 éléments par pièce MAXIMUM, jamais de remplissage en tapis intégral

Blocs et états :
- Blocs autorisés UNIQUEMENT : ${[...INTERIOR_BLOCKS].join(', ')}
- Les blocs orientables portent leur état entre crochets : "wall_torch[facing=east]" (facing = direction OPPOSÉE au mur porteur), lit en DEUX blocs "red_bed[facing=north,part=foot]" puis "red_bed[facing=north,part=head]" dans la direction du facing
- Les blocs posés au sol sans orientation (barrel, bookshelf, crafting_table, lantern, flower_pot...) s'écrivent sans crochets

Code COMPACT : boucles et fonctions d'aide, jamais de longues listes de blocs un par un.`, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Bâtiment : ${description.type_batiment || 'bâtiment'}, style ${description.style || 'non précisé'}.\nDimensions ${d.x}x${d.z}x${d.y} (x,z,y).\n\n${cartes}\n\nÉcris generateStructure().`
      }]
    }), { retries: 1 });
    if (response.stop_reason === 'max_tokens') {
      console.warn('[decorateur] réponse tronquée — décoration ignorée');
      return [];
    }
    const code = stripCodeFences(response.content.find((b) => b.type === 'text').text);
    if (!code.includes('// FIN_STRUCTURE')) {
      console.warn('[decorateur] sentinelle absente (réponse tronquée ?) — décoration ignorée');
      return [];
    }
    const raw = runStructureCode(code, timeoutMs);
    const filtered = raw.filter((b) => b && typeof b === 'object'
      && typeof b.block === 'string' && INTERIOR_BLOCKS.has(baseOf(b.block))
      && Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.z)
      && b.x >= 0 && b.x < d.x && b.y >= 0 && b.y < d.y && b.z >= 0 && b.z < d.z
      && !occupied.has(`${b.x},${b.y},${b.z}`));
    // Physique du décor : sous un toit (bloc de structure plus haut dans la colonne),
    // et attaché (adjacent à la structure ou posé sur un élément déjà conservé)
    const underRoof = (b) => {
      for (let yy = b.y + 1; yy < d.y; yy++) if (occupied.has(`${b.x},${yy},${b.z}`)) return true;
      return false;
    };
    const keptDecor = new Set();
    const physical = [];
    for (const b of [...filtered].sort((p, q) => p.y - q.y)) {
      if (!underRoof(b)) continue;
      const touching = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) =>
        occupied.has(`${b.x + dx},${b.y + dy},${b.z + dz}`) || keptDecor.has(`${b.x + dx},${b.y + dy},${b.z + dz}`));
      if (!touching) continue;
      keptDecor.add(`${b.x},${b.y},${b.z}`);
      physical.push(b);
    }
    const anchored = fixAttachments(physical, (x, y, z) => occupied.has(`${x},${y},${z}`));
    const cap = Math.ceil(d.x * d.z * floors.length * 0.10);
    if (anchored.length > cap) {
      const step = anchored.length / cap;
      const thinned = [];
      for (let i = 0; i < anchored.length; i += step) thinned.push(anchored[Math.floor(i)]);
      console.warn(`[decorateur] densité plafonnée : ${anchored.length} → ${thinned.length}`);
      return thinned.slice(0, cap);
    }
    return anchored;
  } catch (err) {
    console.warn('[decorateur] indisponible :', err.message);
    return [];
  }
}

module.exports = { detectFloors, decorateInterior, fixAttachments };

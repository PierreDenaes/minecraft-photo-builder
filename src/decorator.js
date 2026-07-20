const { withRetry, stripCodeFences } = require('./llm');
const { INTERIOR_BLOCKS } = require('./blockcolors');
const { getSections } = require('./almanach');
const { detectFloors, detectRooms, furnishRooms, dimsOf } = require('./rooms');

// classification simple : Haiku suffit
const MODEL_SETS = 'claude-haiku-4-5-20251001';

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
      // l'orientation fournie est ignorée : recalculée d'après le mur réel
      if (base === 'torch' && below) block = 'torch';
      else if (lateral) block = `wall_torch[facing=${lateral[0]}]`;
      else if (below) block = 'torch';
      else continue;
    } else if (base.endsWith('_bed')) {
      if (/part=head/.test(b.block)) continue; // la tête est régénérée depuis le pied
      if (!below) continue;
      const facing = (/facing=(north|south|east|west)/.exec(b.block) || [, 'north'])[1];
      const [dx, dz] = BED_HEAD[facing];
      if (solidAt(b.x + dx, b.y, b.z + dz)) continue; // la tête percuterait un mur
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

// Set de repli déterministe quand le LLM est indisponible : mobilier générique
const DEFAULT_SET = ['wall_torch', 'barrel', 'bookshelf', 'crafting_table'];

// Le LLM ne choisit que la SÉMANTIQUE (rôle et mobilier de chaque pièce) ;
// les positions sont calculées mécaniquement par furnishRooms
async function chooseFurnitureSets(rooms, description, { client } = {}) {
  const fallback = rooms.map(() => ({ role: 'piece', meubles: DEFAULT_SET }));
  if (!client) return fallback;
  try {
    const roomsDesc = rooms.map((r, i) => ({ piece: i, etage: r.y, taille_cases: r.cells.length }));
    const response = await withRetry(() => client.messages.create({
      model: MODEL_SETS,
      max_tokens: 800,
      temperature: 0,
      system: `Tu es décorateur d'intérieur Minecraft. Pour chaque pièce listée, choisis un rôle cohérent avec le bâtiment (chambre, coin repas, bibliothèque, atelier, entrée...) et 3 à 6 blocs de mobilier adaptés, UNIQUEMENT parmi : ${[...INTERIOR_BLOCKS].join(', ')}. Une chapelle n'a pas de lit, une forge a des fourneaux. Réponds UNIQUEMENT en JSON strict : [{"piece":N,"role":"...","meubles":["bloc",...]}], une entrée par pièce, dans l'ordre.`,
      messages: [{
        role: 'user',
        content: `Bâtiment : ${description.type_batiment || 'bâtiment'}, style ${description.style || 'non précisé'}.\nPièces : ${JSON.stringify(roomsDesc)}\n\nRéférentiel (applique ces règles) :\n${getSections([7])}`
      }]
    }), { retries: 1 });
    const rawT = stripCodeFences(response.content.find((b) => b.type === 'text').text).trim();
    const parsed = JSON.parse(rawT.startsWith('[') ? rawT : `[${rawT}`);
    return rooms.map((_, i) => {
      const meubles = (parsed[i]?.meubles || []).filter((m) => INTERIOR_BLOCKS.has(baseOf(String(m))));
      return meubles.length > 0 ? { role: parsed[i].role, meubles } : fallback[i];
    });
  } catch (err) {
    console.warn('[decorateur] choix de mobilier LLM indisponible, repli générique :', err.message);
    return fallback;
  }
}

async function decorateInterior(building, description, { client } = {}) {
  const rooms = detectRooms(building);
  if (rooms.length === 0) return [];
  const d = dimsOf(building);
  const occupied = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  const sets = await chooseFurnitureSets(rooms, description, { client });
  const raw = furnishRooms(building, rooms, sets);
  // Physique : sous un toit uniquement (pas de meubles sur les remparts), hors structure
  const underRoof = (b) => {
    for (let yy = b.y + 1; yy < d.y; yy++) if (occupied.has(`${b.x},${yy},${b.z}`)) return true;
    return false;
  };
  const covered = raw.filter((b) => underRoof(b) && !occupied.has(`${b.x},${b.y},${b.z}`));
  const anchored = fixAttachments(covered, (x, y, z) => occupied.has(`${x},${y},${z}`));
  const cap = Math.ceil(d.x * d.z * Math.max(1, detectFloors(building).length) * 0.10);
  if (anchored.length > cap) {
    const step = anchored.length / cap;
    const thinned = [];
    for (let i = 0; i < anchored.length; i += step) thinned.push(anchored[Math.floor(i)]);
    console.warn(`[decorateur] densité plafonnée : ${anchored.length} → ${thinned.length}`);
    return thinned.slice(0, cap);
  }
  return anchored;
}

module.exports = { detectFloors, decorateInterior, fixAttachments, chooseFurnitureSets };

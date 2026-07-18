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
  const perY = new Map();
  for (const b of building) perY.set(b.y, (perY.get(b.y) || 0) + 1);
  const footprint = d.x * d.z;
  const floors = [];
  for (let y = 0; y < d.y; y++) {
    if ((perY.get(y) || 0) >= footprint * 0.3) {
      if (floors.length === 0 || y - floors[floors.length - 1] >= 3) floors.push(y);
    }
  }
  return floors;
}

async function decorateInterior(building, description, { client, timeoutMs = 20000 } = {}) {
  const floors = detectFloors(building);
  if (!client || floors.length === 0) return [];
  const d = dimsOf(building);
  const occupied = new Set(building.map((b) => `${b.x},${b.y},${b.z}`));
  try {
    const response = await withRetry(() => client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: `Tu es décorateur d'intérieur Minecraft. Écris une fonction JavaScript pure generateStructure() retournant [{x, y, z, block}] : mobilier, rangements et éclairage posés SUR les planchers (y du plancher + 1), à l'intérieur des murs (marge de 1 bloc), pièces cohérentes (coin repas, bibliothèque, atelier, éclairage régulier aux murs). Blocs autorisés UNIQUEMENT : ${[...INTERIOR_BLOCKS].join(', ')}. Réponds UNIQUEMENT avec le code, sans texte autour.`,
      messages: [{
        role: 'user',
        content: `Bâtiment ${d.x}x${d.z}x${d.y} (x,z,y). Niveaux de plancher (y) : ${floors.join(', ')}. Style : ${description.type_batiment || 'bâtiment'}${description.style ? ' — ' + description.style : ''}. Écris generateStructure().`
      }]
    }), { retries: 1 });
    const code = stripCodeFences(response.content.find((b) => b.type === 'text').text);
    const raw = runStructureCode(code, timeoutMs);
    return raw.filter((b) => b && typeof b === 'object'
      && INTERIOR_BLOCKS.has(b.block)
      && Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.z)
      && b.x >= 0 && b.x < d.x && b.y >= 0 && b.y < d.y && b.z >= 0 && b.z < d.z
      && !occupied.has(`${b.x},${b.y},${b.z}`));
  } catch (err) {
    console.warn('[decorateur] indisponible :', err.message);
    return [];
  }
}

module.exports = { detectFloors, decorateInterior };

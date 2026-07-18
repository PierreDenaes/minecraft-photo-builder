const vm = require('node:vm');
const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Tu écris du code JavaScript pur pour générer une structure Minecraft.
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown.

Contraintes strictes :
- Définis une fonction generateStructure() qui retourne un tableau [{x, y, z, block}]
- Coordonnées entières >= 0 ; x = largeur, y = hauteur (0 = sol), z = profondeur
- Reste dans les dimensions estimées de la description
- Utilise uniquement les blocs de palette_blocs, plus "air" pour les ouvertures (portes, fenêtres) et "glass_pane" pour les vitres
- Code pur : pas de require, pas d'accès réseau/fichiers, pas de récursion infinie
- Construis paramétriquement : murs pleins, ouvertures, toit selon la forme décrite
- Les intérieurs sont creux (air)

Qualité et détail (important) :
- Vise le MAXIMUM de détail architectural : varie les matériaux (3 à 5 blocs différents par façade)
- Utilise les stairs/slabs/walls de la liste autorisée pour les corniches, encadrements, débords de toit, créneaux
- Fenêtres avec encadrement (log ou stone autour du glass_pane), porte avec porche ou arche
- Évite les grands murs plats uniformes : ajoute pilastres, retraits, variations de profondeur de 1 bloc
- Les tours sont cylindriques (teste x*x + z*z contre un rayon), les toits coniques ou en pente réguliers
- Ajoute les éléments notables décrits (cheminées, tourelles, créneaux, drapeaux en wool, lave si décrit)

Rôle d'architecte (quand un résumé structurel est fourni) :
- Le résumé décrit une référence réelle : respecte ses masses — emprise (footprint), carte de hauteurs, position/hauteur/rayon des tours
- La "carte" du résumé est une vue de dessus ASCII (0 = vide, 9 = point culminant) : reproduis ses masses et son agencement
- Reconstruis PROPREMENT en vocabulaire Minecraft : murs droits et pleins, créneaux, arches, fenêtres alignées, toits cohérents — jamais le bruit du scan
- Reste dans dims ; les tours sont cylindriques aux positions données
- Budget du bâtiment : 96×64×96 MAXIMUM — si le résumé est plus grand, réduis TOUT à l'échelle (proportions conservées)
- Code EFFICACE : boucle sur les surfaces (murs, sols, toits), jamais sur le volume plein de la boîte
- GRAVITÉ : chaque bloc doit être supporté (chemin de blocs jusqu'au sol y=0) — aucun élément flottant`;

function runStructureCode(code, timeoutMs) {
  const context = vm.createContext(Object.create(null));
  const script = new vm.Script(`${code}\ngenerateStructure();`);
  const result = script.runInContext(context, { timeout: timeoutMs });
  if (!Array.isArray(result)) {
    throw new Error('generateStructure() doit retourner un tableau de blocs');
  }
  // Convertir les objets VM en objets du contexte hôte pour que deepStrictEqual fonctionne
  let blocks;
  try {
    blocks = JSON.parse(JSON.stringify(result));
  } catch {
    throw new Error('generateStructure() a retourné une structure non sérialisable');
  }
  return normalizeOrigin(blocks);
}

// Les LLM produisent souvent des débords (toit) en coordonnées négatives :
// on translate la structure pour que son coin minimum soit à l'origine.
function normalizeOrigin(blocks) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  for (const b of blocks) {
    if (!b || typeof b !== 'object') return blocks;
    for (const axis of ['x', 'y', 'z']) {
      if (Number.isInteger(b[axis])) min[axis] = Math.min(min[axis], b[axis]);
    }
  }
  for (const axis of ['x', 'y', 'z']) {
    if (Number.isFinite(min[axis]) && min[axis] < 0) {
      for (const b of blocks) {
        if (Number.isInteger(b[axis])) b[axis] -= min[axis];
      }
    }
  }
  return blocks;
}

async function generateStructure(description, { client, timeoutMs = 5000, validBlocks, structuralSummary } = {}) {
  const c = client || createClient();
  const blocksSection = validBlocks
    ? `\n\nBlocs autorisés — n'utilise QUE ces noms, aucun autre :\n${validBlocks.join(', ')}`
    : '';
  const summarySection = structuralSummary
    ? `\n\nRésumé structurel de la référence (respecte ces masses) :\n${JSON.stringify(structuralSummary)}`
    : '';
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Description du bâtiment :\n${JSON.stringify(description, null, 2)}${summarySection}${blocksSection}\n\nÉcris generateStructure().`
      }]
    })
  );
  if (response.stop_reason === 'max_tokens') {
    throw new Error('génération tronquée (max_tokens atteint) — réessaie avec une photo plus simple');
  }
  const code = stripCodeFences(response.content.find((b) => b.type === 'text').text);
  console.log('[generator] code généré :\n', code);
  return runStructureCode(code, timeoutMs);
}

module.exports = { runStructureCode, generateStructure };

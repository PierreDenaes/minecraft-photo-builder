const vm = require('node:vm');
const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Tu écris du code JavaScript pur pour générer une structure Minecraft (version 1.20).
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown.
Termine ton code par le commentaire exact : // FIN_STRUCTURE

## Contrat
- Définis une fonction generateStructure() qui retourne un tableau [{x, y, z, block}]
- Coordonnées entières >= 0 ; x = largeur, y = hauteur (0 = sol), z = profondeur
- Budget spatial ABSOLU : 96 (x) × 64 (y) × 96 (z). Si la description ou le résumé dépasse, réduis TOUT à l'échelle en conservant les proportions
- Code pur et déterministe : pas de require, pas d'accès réseau/fichiers, pas de récursion, AUCUN Math.random (si tu veux de la variation, utilise (x*7 + z*13 + y*31) % n)
- Code EFFICACE et COMPACT (< 250 lignes) : boucle sur les surfaces (murs, sols, toits), jamais sur le volume plein ; utilise des fonctions d'aide (mur, boite, toitDeuxPans...)

## Blocs et états
- Blocs de base : uniquement ceux de palette_blocs, plus "air" pour les ouvertures
- Pour chaque bloc de palette tu peux utiliser les variantes de la MÊME famille de matériau : stairs, slab, wall, fence (ex : palette "stone_bricks" autorise stone_brick_stairs, stone_brick_slab, stone_brick_wall)
- Accessoires toujours autorisés : glass_pane, oak_door, ladder, lantern, torch
- Les blocs orientables portent leur état entre crochets dans la chaîne block :
  - stairs : "oak_stairs[facing=north,half=bottom]" (facing = direction que la MONTÉE regarde, half=top pour les marches inversées sous les corniches)
  - portes : DEUX blocs empilés, "oak_door[facing=south,half=lower]" en bas et "oak_door[facing=south,half=upper]" juste au-dessus
  - slabs : "stone_brick_slab[type=bottom]" ou [type=top]
  - torches murales : "wall_torch[facing=east]" (facing = direction OPPOSÉE au mur porteur)
- Un toit en pente est fait de stairs orientées : versant nord = facing=south, versant sud = facing=north, etc. Les stairs d'un même versant ont toutes le même facing

## Architecture
- Reste dans les dimensions estimées de la description
- Intérieurs HABITABLES : un plancher plein tous les 5 à 6 blocs de hauteur (oak_planks ou pierre selon le style), un escalier reliant chaque étage, 2 à 4 pièces par étage séparées par des cloisons avec portes
- ACCESSIBILITÉ : chaque pièce a une porte ou une ouverture de 1×2 ; les escaliers sont ALIGNÉS verticalement (même x,z à chaque étage) et débouchent sur un couloir ; l'entrée principale donne sur la circulation
- Le toit est COMPLET et fermé : il couvre toute l'emprise des murs sans trou, pignons remplis
- Le toit déborde d'au plus 1 bloc au-delà des murs ; aucune dalle horizontale plus large que l'emprise
- COHÉSION : chaque bloc est adjacent face contre face au reste de la structure ; aucun élément détaché ou flottant dans le vide (les débords de toit et corniches accrochés à la structure sont autorisés)

## Qualité et détail
- Vise le MAXIMUM de détail architectural : 3 à 5 matériaux différents par façade (en comptant les variantes stairs/slab/wall de la palette)
- Corniches, encadrements, débords de toit et créneaux avec les stairs/slabs/walls
- Fenêtres avec encadrement (log ou pierre autour du glass_pane), porte principale avec porche ou arche
- Pas de grands murs plats uniformes : pilastres, retraits, variations de profondeur de 1 bloc
- Les tours sont cylindriques (teste dx*dx + dz*dz <= rayon*rayon), toits coniques ou pentes régulières
- Ajoute les éléments notables décrits (cheminées, tourelles, créneaux, drapeaux en wool, lave si décrit)

## Rôle d'architecte (quand un résumé structurel est fourni)
- Le résumé décrit une référence réelle : respecte ses masses, son emprise, sa carte de hauteurs, la position/hauteur/rayon des tours
- La "carte" est une vue de dessus ASCII (0 = vide, 9 = point culminant) : reproduis ses masses et son agencement
- Reconstruis PROPREMENT en vocabulaire Minecraft : murs droits, créneaux, arches, fenêtres alignées, toits cohérents ; jamais le bruit du scan`;

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

const SENTINEL = '// FIN_STRUCTURE';
const MAX_ATTEMPTS = 3;

// Complétion mécanique des portes : le LLM oublie parfois la moitié haute
function completeDoors(blocks) {
  const occ = new Set(blocks.map((b) => `${b.x},${b.y},${b.z}`));
  const added = [];
  for (const b of blocks) {
    const m = /^([a-z_0-9]+_door)\[([^\]]*half=lower[^\]]*)\]$/.exec(b.block);
    if (!m) continue;
    if (occ.has(`${b.x},${b.y + 1},${b.z}`)) continue;
    added.push({ x: b.x, y: b.y + 1, z: b.z, block: `${m[1]}[${m[2].replace('half=lower', 'half=upper')}]` });
    occ.add(`${b.x},${b.y + 1},${b.z}`);
  }
  return blocks.concat(added);
}

async function generateStructure(description, { client, timeoutMs = 5000, validBlocks, structuralSummary, image, correction } = {}) {
  const c = client || createClient();
  const blocksSection = validBlocks
    ? `\n\nBlocs autorisés — n'utilise QUE ces noms, aucun autre :\n${validBlocks.join(', ')}`
    : '';
  const summarySection = structuralSummary
    ? `\n\nRésumé structurel de la référence (respecte ces masses) :\n${JSON.stringify(structuralSummary)}`
    : '';
  const imageSection = image
    ? '\n\nLa photo jointe est LA référence : calque les proportions, le nombre et le rythme des ouvertures, la forme exacte du toit et les couleurs sur ce que tu VOIS, pas seulement sur la description.'
    : '';
  const userText = correction
    ? `Voici le code de la PREMIÈRE version générée :\n\n<code_v1>\n${correction.codeV1}\n</code_v1>\n\nCette version a été comparée à la photo de référence (jointe). Écarts et défauts constatés :\n\n${correction.critique || ''}\n${correction.defauts || ''}\n\nMODIFIE ce code pour corriger TOUS les écarts listés.\n- Conserve tout ce qui n'est pas critiqué : mêmes dimensions générales, même organisation intérieure, mêmes parties réussies\n- Ne repars pas de zéro\n- Chaque écart listé doit avoir une correction identifiable dans le code\nRéponds UNIQUEMENT avec le code complet corrigé, terminé par ${SENTINEL}.`
    : `Description du bâtiment :\n${JSON.stringify(description, null, 2)}${summarySection}${blocksSection}${imageSection}\n\nÉcris generateStructure().`;
  const content = image
    ? [
      { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
      { type: 'text', text: userText }
    ]
    : userText;
  // Boucle de re-prompt : une erreur d'exécution est réinjectée dans la conversation
  // (pattern mindcraft) — la troncature, elle, ne se corrige pas en retentant
  const messages = [{ role: 'user', content }];
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await withRetry(() =>
      c.messages.create({
        model: MODEL,
        max_tokens: 16000,
        temperature: 0.2,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages
      })
    );
    if (response.stop_reason === 'max_tokens') {
      throw new Error('génération tronquée (max_tokens atteint) — réessaie avec une photo plus simple');
    }
    const raw = response.content.find((b) => b.type === 'text').text;
    const code = stripCodeFences(raw);
    try {
      if (!code.includes(SENTINEL)) {
        throw new Error(`génération tronquée (sentinelle ${SENTINEL} absente)`);
      }
      const blocks = completeDoors(runStructureCode(code, timeoutMs));
      console.log('[generator] code généré :\n', code);
      return { blocks, code };
    } catch (err) {
      lastErr = err;
      if (/tronquée \(max_tokens/.test(err.message)) throw err;
      console.warn(`[generator] tentative ${attempt}/${MAX_ATTEMPTS} échouée :`, err.message);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `L'exécution du code a échoué : ${err.message}\nCorrige le code et renvoie-le COMPLET, terminé par ${SENTINEL}.`
      });
    }
  }
  throw lastErr;
}

module.exports = { runStructureCode, generateStructure, completeDoors };

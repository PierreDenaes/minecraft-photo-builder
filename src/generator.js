const vm = require('node:vm');
const { createClient, withRetry, stripCodeFences } = require('./llm');
const { getSections, getFicheStyle, getFicheToit } = require('./almanach');
const fs = require('node:fs');
const path = require('node:path');
const primitives = require('./primitives');

// Références issues des schemas Sponge (docs/schem/) : vocabulaire de vrais
// bâtiments par style — sert à guider le choix des matériaux par le LLM
let SCHEM_REFS = [];
try { SCHEM_REFS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/schem-refs.json'), 'utf8')); } catch { /* absent */ }
function schemRefsFor(style) {
  const priority = SCHEM_REFS.filter((r) => r.style === style);
  // Pas de padding hors-style : mieux vaut 1 ref pertinente que 1+2 mismatchées
  const chosen = priority.length > 0 ? priority.slice(0, 3) : SCHEM_REFS.slice(0, 3);
  if (chosen.length === 0) return '';
  const lines = chosen.map((r) => `- ${r.style} (${r.dims.x}×${r.dims.y}×${r.dims.z}) : matériaux dominants ${r.top_materiaux.slice(0, 5).join(', ')} ; ratio stairs ${r.ratios.stairs}%, glass ${r.ratios.glass}%`);
  return `\n\nRéférences de vrais bâtiments (vocabulaire de matériaux à imiter selon le style) :\n${lines.join('\n')}`;
}

const PRIMITIVES_SANDBOX = { ...primitives, Math };
const PRIMITIVES_PROMPT = `Tu écris du code JavaScript pur pour composer une structure Minecraft en appelant UNIQUEMENT les primitives fournies.
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown.
Termine ton code par le commentaire exact : // FIN_STRUCTURE

## Contrat
- Définis une fonction generateStructure() qui retourne un tableau [{x, y, z, block}] — concatène simplement les résultats des primitives que tu appelles.
- Coordonnées entières >= 0 ; x = largeur, y = hauteur (0 = sol), z = profondeur ; budget spatial 96×64×96 MAXIMUM.
- INTERDICTION FORMELLE : tu ne poses AUCUN bloc directement. Pas de push({x,y,z,block:...}). Pas de fonction \`place\`. Aucun nom de bloc hors des paramètres materiau/murs/fondation/etc. passés aux primitives.
- Le sandbox n'expose QUE : les 8 primitives ci-dessous + Math. Toute autre référence (require, place, fs...) lève une ReferenceError.

## Primitives disponibles
- boite({ x1, z1, x2, z2, y0, y1, murs, fondation?, plancher? }) — 4 murs pleins + dalle basse (fondation ou murs) + dalle haute (plancher, facultative)
- porte({ facade: 'nord'|'sud'|'est'|'ouest', x, z, y0, hauteur=2, materiau }) — perce une ouverture 1×hauteur dans le mur de la façade, linteau du materiau, porte battante orientée vers l'intérieur
- baie({ facade, x1, z1, x2, z2, y1, y2, encadrement, illumine=false }) — glass_pane sur la rangée, encadrement autour ; illumine=true met du glowstone derrière (ambiance chaude, à activer si l'ambiance de la photo est crépusculaire/nocturne/lumières intérieures allumées)
- toitPlat({ x1, z1, x2, z2, y, materiau, acrotere=true, debord=1 })
- toitDeuxPans({ x1, z1, x2, z2, y_base, faitage: 'x'|'z', materiau, debord=1 }) — materiau = préfixe bois ("oak", "dark_oak", "spruce"...) qui donne stairs et planks
- toitQuatrePans({ x1, z1, x2, z2, y_base, materiau, debord=1 })
- escalier({ x, z, y_bas, y_haut, facing: 'east'|'west'|'north'|'south', materiau, tremie=true, largeur=1 })
- piscine({ x1, z1, x2, z2, y_surface, profondeur=2, bordure })
- tour({ x, z, rayon, y_bas, y_haut, materiau, toit_conique=true, creneaux=false }) — cylindre creux centré sur (x,z), dalles pleines aux extrémités, paroi d'1 bloc, toit conique et/ou créneaux au sommet ; materiau peut être un préfixe bois ("oak"...) ou un bloc plein ("stone_bricks")
- lampadaire({ x, z, y0, hauteur=5, materiau='dark_oak_fence' }) — poteau vertical de fences + lanterne au sommet
- terrasse({ x1, z1, x2, z2, y, materiau, bordure? }) — dalle horizontale au sol + bordure murée optionnelle sur le pourtour
- pontonBois({ x1, z1, x2, z2, y, materiau='oak_planks', pilotis=true }) — planches surélevées + pilotis aux coins descendant jusqu'à y=0
- haie({ x1, z1, x2, z2, y, essence='oak_leaves', hauteur=2 }) — rangée de feuilles persistantes
- bordurePlantes({ x1, z1, x2, z2, y, materiau='azalea_leaves' }) — 1 rangée basse de plantes (bordure de terrasse/piscine)
- perron({ x, z, y0=0, largeur=3, marches=2, materiau, facing }) — marches ascendantes devant une porte (facing = direction où se trouve la porte)
- gardeCorps({ x1, z1, x2, z2, y, materiau='iron_bars' }) — rangée sur le pourtour d'une terrasse/balcon

## Règles de composition
- Une porte doit être dans un mur existant (même x/z que la façade de la boite).
- CHAQUE bâtiment habitable a AU MOINS UNE porte en façade — le bâtiment principal en premier.
- Une baie doit être dans un mur existant.
- Un escalier doit partir du plancher de la boite (y_bas) et arriver au plancher haut (y_haut = y1 de la boite).
- Un toit doit couvrir l'emprise de la boite (mêmes x1/x2/z1/z2).
- Une piscine est HORS de la boite (à côté), pas dedans, et **s'enterre** : si la maison est au sol y=0, la surface de la piscine doit être à y=profondeur (par ex. y_surface=2 pour profondeur=2), le fond restant à y=0. Ne pose JAMAIS y_surface<profondeur, sinon le fond passerait sous y=0 et toute la scène flotterait.
- Si un **résumé structurel** (carte de hauteurs ASCII 0-9, tours détectées, dims) est fourni : n'essaie PAS de recopier la carte bloc-à-bloc. ABSTRAIS-la en 2 à 6 primitives : zones à valeur ≥7 → tour({rayon, y_haut=valeur}), masses centrales à valeur ≥3 → boite, faîtage détecté → toitDeuxPans. La carte guide les proportions, pas la géométrie fine.

## Palette par zone (utilise 3 à 5 matériaux différents, jamais un seul)
- palette_blocs.murs = matière PRINCIPALE des façades (boite murs).
- palette_blocs.accents = allèges, bandeaux, débords contrastants (souvent une variante sombre : deepslate_tiles, dark_oak_planks, black_concrete). Utilise pour toits plats, corniches, gardeCorps.
- palette_blocs.menuiseries = encadrements de baies et portes (souvent bois : dark_oak_log, spruce_log).
- palette_blocs.exterieur = terrasse, ponton, bordure (souvent smooth_stone, oak_planks).
- palette_blocs.toit = matière du toit (préfixe bois pour toitDeuxPans/QuatrePans, bloc pour toitPlat).
- Fallback : si un champ manque, réutilise murs ou toit. Mais 1 seul matériau sur tout = façade médiocre.

## Fidélité aux travées et détails extérieurs
- Si travees.facade_principale = N, appelle baie EXACTEMENT N fois sur cette façade, régulièrement espacées.
- Si elements contient "balcon", "garde-corps", "marches", "lampadaires", "terrasse", "ponton" → utilise les primitives correspondantes (perron, gardeCorps, lampadaire, terrasse, pontonBois).
- Une villa moderne = boite blanche + accents sombres en toitPlat + baies larges avec encadrement bois + perron + gardeCorps sur balcon + 2 à 4 lampadaires devant.

## Exemple 1 — maison simple 8×6 à un étage
function generateStructure() {
  const b1 = boite({ x1: 0, z1: 0, x2: 7, z2: 5, y0: 0, y1: 4, murs: 'stone_bricks', fondation: 'cobblestone', plancher: 'oak_planks' });
  const p = porte({ facade: 'sud', x: 3, z: 0, y0: 0, materiau: 'stone_bricks' });
  const w1 = baie({ facade: 'sud', x1: 5, x2: 6, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'oak_log' });
  const w2 = baie({ facade: 'est', x1: 7, x2: 7, z1: 2, z2: 3, y1: 2, y2: 3, encadrement: 'oak_log' });
  const t = toitDeuxPans({ x1: 0, z1: 0, x2: 7, z2: 5, y_base: 4, faitage: 'x', materiau: 'dark_oak' });
  return [...b1, ...p, ...w1, ...w2, ...t];
  // FIN_STRUCTURE
}

## Exemple 2 — villa contemporaine avec piscine
function generateStructure() {
  const b1 = boite({ x1: 0, z1: 0, x2: 11, z2: 8, y0: 0, y1: 4, murs: 'white_concrete', fondation: 'smooth_stone', plancher: 'oak_planks' });
  const b2 = boite({ x1: 0, z1: 0, x2: 11, z2: 8, y0: 4, y1: 8, murs: 'white_concrete', plancher: 'light_gray_concrete' });
  const p = porte({ facade: 'sud', x: 5, z: 0, y0: 0, materiau: 'dark_oak_log' });
  const w1 = baie({ facade: 'sud', x1: 1, x2: 3, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'dark_oak_log' });
  const w2 = baie({ facade: 'sud', x1: 7, x2: 10, z1: 0, z2: 0, y1: 2, y2: 3, encadrement: 'dark_oak_log' });
  const w3 = baie({ facade: 'sud', x1: 1, x2: 10, z1: 0, z2: 0, y1: 6, y2: 7, encadrement: 'dark_oak_log' });
  const e = escalier({ x: 8, z: 5, y_bas: 0, y_haut: 4, facing: 'east', materiau: 'oak' });
  const t = toitPlat({ x1: 0, z1: 0, x2: 11, z2: 8, y: 8, materiau: 'light_gray_concrete' });
  const pool = piscine({ x1: 15, z1: 2, x2: 25, z2: 6, y_surface: 1, profondeur: 2, bordure: 'smooth_stone' });
  return [...b1, ...b2, ...p, ...w1, ...w2, ...w3, ...e, ...t, ...pool];
  // FIN_STRUCTURE
}

## Exemple 3 — château médiéval avec 4 tours d'angle (mode diorama / modèle 3D scanné)
function generateStructure() {
  const corps = boite({ x1: 6, z1: 6, x2: 21, z2: 21, y0: 0, y1: 6, murs: 'cobblestone', fondation: 'stone_bricks', plancher: 'oak_planks' });
  const porte1 = porte({ facade: 'sud', x: 13, z: 6, y0: 0, hauteur: 3, materiau: 'dark_oak_log' });
  const t1 = tour({ x: 3, z: 3, rayon: 3, y_bas: 0, y_haut: 10, materiau: 'cobblestone', creneaux: true, toit_conique: false });
  const t2 = tour({ x: 24, z: 3, rayon: 3, y_bas: 0, y_haut: 10, materiau: 'cobblestone', creneaux: true, toit_conique: false });
  const t3 = tour({ x: 3, z: 24, rayon: 3, y_bas: 0, y_haut: 10, materiau: 'cobblestone', creneaux: true, toit_conique: false });
  const t4 = tour({ x: 24, z: 24, rayon: 3, y_bas: 0, y_haut: 10, materiau: 'cobblestone', creneaux: true, toit_conique: false });
  const esc = escalier({ x: 18, z: 15, y_bas: 0, y_haut: 6, facing: 'east', materiau: 'oak' });
  const toit = toitQuatrePans({ x1: 6, z1: 6, x2: 21, z2: 21, y_base: 6, materiau: 'dark_oak' });
  return [...corps, ...porte1, ...t1, ...t2, ...t3, ...t4, ...esc, ...toit];
  // FIN_STRUCTURE
}`;


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

function runStructureCode(code, timeoutMs, sandbox = {}) {
  // Base null-prototype pour interdire l'évasion via this.constructor.constructor
  const context = vm.createContext(Object.assign(Object.create(null), sandbox));
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

async function generateStructure(description, { client, timeoutMs = 5000, validBlocks, existingBlocks, structuralSummary, image, correction, mode } = {}) {
  const usingPrimitives = mode === 'primitives';
  const activePrompt = usingPrimitives ? PRIMITIVES_PROMPT : SYSTEM_PROMPT;
  const sandbox = usingPrimitives ? PRIMITIVES_SANDBOX : {};
  const c = client || createClient();
  // en mode primitives, le LLM ne cite plus de blocs individuels — juste des materiau
  const blocksSection = validBlocks && !usingPrimitives
    ? `\n\nBlocs autorisés — n'utilise QUE ces noms, aucun autre :\n${validBlocks.join(', ')}`
    : '';
  const summarySection = structuralSummary
    ? `\n\nRésumé structurel de la référence (respecte ces masses) :\n${JSON.stringify(structuralSummary)}`
    : '';
  const imageSection = image
    ? '\n\nLa photo jointe est LA référence : calque les proportions, le nombre et le rythme des ouvertures, la forme exacte du toit et les couleurs sur ce que tu VOIS, pas seulement sur la description.'
    : '';
  // En mode primitives, l'almanach parle de blocs et de détails (colombages, trapdoors...)
  // que les 8 primitives ne peuvent pas exprimer : la fiche de style seule suffit
  const referentiel = usingPrimitives
    ? `\n\nStyle de la photo (inspiration pour choisir les materiau des primitives) :\n${getFicheStyle(description.style)}${schemRefsFor(description.style)}`
    : (() => {
        const refIds = [4, 10];
        const tourSource = `${JSON.stringify(description.elements || [])} ${JSON.stringify(structuralSummary || {})}`;
        if (/tour/i.test(tourSource)) refIds.push(6);
        if (description.cadrage === 'scene_complete') refIds.push(9);
        return `\n\nRéférentiel de construction (applique ces règles) :\n${getSections([1])}\n\nFiche toit :\n${getFicheToit(description.toit?.forme)}\n\nFiche style :\n${getFicheStyle(description.style)}\n\n${getSections(refIds)}`;
      })();
  const userText = correction
    ? `Voici le code de la PREMIÈRE version générée :\n\n<code_v1>\n${correction.codeV1}\n</code_v1>\n\nCette version a été comparée à la photo de référence (jointe). Écarts et défauts constatés :\n\n${correction.critique || ''}\n${correction.defauts || ''}\n\nMODIFIE ce code pour corriger TOUS les écarts listés.\n- Conserve tout ce qui n'est pas critiqué : mêmes dimensions générales, même organisation intérieure, mêmes parties réussies\n- Ne repars pas de zéro\n- Chaque écart listé doit avoir une correction identifiable dans le code\nRéponds UNIQUEMENT avec le code complet corrigé, terminé par ${SENTINEL}.${referentiel}`
    : `Description du bâtiment :\n${JSON.stringify(description, null, 2)}${summarySection}${blocksSection}${imageSection}${referentiel}\n\nÉcris generateStructure().`;
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
        system: [{ type: 'text', text: activePrompt, cache_control: { type: 'ephemeral' } }],
        messages
      })
    );
    if (response.stop_reason === 'max_tokens') {
      throw new Error('génération tronquée (max_tokens atteint) — réessaie avec une photo plus simple');
    }
    const raw = response.content.find((b) => b.type === 'text').text;
    const code = stripCodeFences(raw);
    if (!code.includes(SENTINEL)) {
      throw new Error(`génération tronquée (sentinelle ${SENTINEL} absente)`);
    }
    try {
      const blocks = completeDoors(runStructureCode(code, timeoutMs, sandbox));
      // Blocs inventés (ex : smooth_stone_wall n'existe pas) : réinjectés dans la
      // boucle pour que le modèle les corrige lui-même
      // existence contre la liste blanche COMPLÈTE : la palette (validBlocks)
      // guide le style, les variantes stairs/slab/wall existantes restent légales
      if (validBlocks || existingBlocks) {
        const valid = new Set(existingBlocks || validBlocks);
        const alwaysOk = new Set(['air', 'glass_pane', 'oak_door', 'ladder', 'lantern', 'torch', 'wall_torch']);
        const unknown = [...new Set(blocks
          .map((b) => String(b.block).replace(/\[[^\]]*\]$/, ''))
          .filter((n) => !valid.has(n) && !alwaysOk.has(n)))];
        if (unknown.length > 0) {
          throw new Error(usingPrimitives
            ? `blocs inexistants dans Minecraft 1.20 : ${unknown.join(', ')} — vérifie les arguments materiau/murs/fondation/plancher/encadrement/bordure passés aux primitives. Attention : pour toitDeuxPans/toitQuatrePans, materiau est un préfixe bois (par ex. "oak", "dark_oak") qui donne stairs et planks ; smooth_stone n'a qu'une slab.`
            : `blocs inexistants dans Minecraft 1.20 ou hors liste autorisée : ${unknown.join(', ')} — remplace-les par des blocs de la liste (attention : toutes les familles n'ont pas de variante wall/stairs, smooth_stone n'a qu'une slab)`);
        }
      }
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

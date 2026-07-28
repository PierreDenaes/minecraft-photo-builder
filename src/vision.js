const { createClient, withRetry, stripCodeFences } = require('./llm');

// Analyse principale sur fable-5 (compréhension spatiale + coût contenu).
// Critique compareToPhoto sur opus-4-7 : le verdict photo↔rendu conditionne
// les tours de correction, on privilégie la fiabilité du jugement malgré
// les 2 appels par pipeline.
let MODELS = {};
try { MODELS = require('../config.json').models || {}; } catch { /* défauts ci-dessous */ }
const MODEL_ANALYSE = MODELS.vision_analyse || 'claude-fable-5';
const MODEL_CRITIQUE = MODELS.vision_critique || 'claude-opus-4-7';

const STYLES = ['primitif', 'egyptien', 'antique', 'asiatique_japonais', 'asiatique_chinois', 'oriental',
  'medieval', 'gothique', 'chateau_fort', 'renaissance', 'baroque_classique', 'haussmannien', 'victorien',
  'colonial', 'industriel', 'art_deco', 'moderne', 'brutaliste', 'futuriste', 'rustique',
  'desert_mediterraneen', 'fantaisie', 'autre'];
const TOIT_FORMES = ['plate', 'monopente', 'deux_pans', 'quatre_pans', 'conique', 'mansarde', 'dome'];

function systemPrompt(maxSize, validBlocks) {
  const blocksRule = validBlocks
    ? `\n- Choisis les valeurs de palette_blocs et materiau_suggere UNIQUEMENT dans cette liste : ${validBlocks.join(', ')}`
    : '';
  return `Tu analyses une photo de bâtiment pour un constructeur Minecraft (version 1.20).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown.

Schéma attendu :
{
  "type_batiment": "...",
  "style": "${STYLES.join('|')}",
  "dimensions_estimees": { "largeur": N, "profondeur": N, "hauteur": N },
  "etages": N,
  "toit": { "forme": "${TOIT_FORMES.join('|')}", "materiau_suggere": "bloc_minecraft" },
  "elements": ["..."],
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc", "accents": "bloc", "menuiseries": "bloc", "exterieur": "bloc" },
  "travees": { "facade_principale": N, "autres_facades": N },
  "zone_batiment": { "x": N, "y": N, "largeur": N, "hauteur": N },
  "cadrage": "sujet_seul|scene_complete",
  "environnement": { "vegetation": "...", "arbres": "aucun|epars|dense", "types_arbres": ["chene","sapin","bouleau","acacia"], "sol": "...", "ambiance": "..." }
}

Échelle (règle de calibration, TRÈS important) :
- 1 bloc Minecraft = 1 mètre. Estime les dimensions en mètres réels.
- Repères : une porte ≈ 2 m de haut, un étage de bâtiment ≈ 3 à 4 m, une fenêtre ≈ 1 à 1,5 m, une voiture ≈ 4,5 m de long, un adulte ≈ 1,8 m
- Cohérence obligatoire : hauteur ≈ etages × 4 + hauteur du toit
- Dimensions maximales : ${maxSize} en largeur/profondeur, jusqu'à 320 en hauteur (pour les monuments élancés : tour, gratte-ciel, cathédrale). Une Tour Eiffel = ~330 m dans la réalité, garde 300 en Y et ~80 en X/Z si la photo montre bien une tour. Une maison normale reste sous ${maxSize} sur tous les axes.

Règles :
- Tous les blocs doivent être des noms Minecraft 1.20 valides (snake_case, sans préfixe minecraft:)
- style et toit.forme : choisis UNIQUEMENT parmi les valeurs listées dans le schéma
- Mappe les couleurs/matériaux réels vers les blocs les plus proches
- zone_batiment : rectangle englobant du bâtiment principal, en POURCENTAGES (0 à 100) de la largeur et de la hauteur totales de l'image ; x/y = coin haut-gauche, largeur/hauteur = étendue du rectangle ; omets ce champ s'il n'y a pas de bâtiment net
- S'il y a PLUSIEURS bâtiments : décris uniquement le plus proéminent et n'englobe que lui dans zone_batiment ; mentionne les autres dans elements (ex : "dependance_a_gauche")
- palette_blocs.accents : matière SECONDAIRE contrastante (allèges noires, débords sombres, bandeaux). Repère par exemple un toit en deepslate sur des murs blancs, ou un balcon en bois sur du béton.
- palette_blocs.menuiseries : matière des encadrements de baies et portes (souvent bois : dark_oak_log, spruce_log).
- palette_blocs.exterieur : matière des terrasses, marches, pontons visibles autour du bâtiment (smooth_stone, oak_planks).
- travees : COMPTE les fenêtres visibles par façade. facade_principale = la façade la plus visible sur la photo, autres_facades = moyenne des côtés visibles. Sois PRÉCIS : une villa à 3 grandes baies = travees.facade_principale = 3.
- elements : mentionne aussi "balcon", "garde-corps", "marches_entree", "lampadaires", "terrasse_bois", "ponton", "berge_eau" (bâtiment au bord de l'eau), "colombages", "lierre_vegetation_murale" quand tu les vois.
- cadrage : "sujet_seul" si l'image montre UN sujet principal sans environnement significatif (bâtiment isolé, objet, personne), "scene_complete" si le décor fait partie du sujet (paysage, terrain, jardin)
- environnement : décris TOUJOURS la végétation (densité d'arbres : aucun/epars/dense, essences parmi chene/sapin/bouleau/acacia), la nature du sol et l'ambiance générale de la scène
- MONUMENTS NON HABITABLES : identifie explicitement les cas suivants dans type_batiment quand tu les reconnais, car ils appellent des primitives spécifiques (arche, tour, colonnes) plutôt qu'un bâtiment habitable normal :
  * arc_de_triomphe, arche, porte_de_ville, aqueduc → structure percée d'un tunnel voûté (l'arche EST la caractéristique principale, jamais un massif plein)
  * tour_isolee, minaret, campanile, obelisque, colonne_commemorative → structure verticale étroite, silhouette élancée prime sur habitabilité
  * statue_monumentale, sculpture → silhouette figurative, pas un bâtiment
  Pour ces monuments : dimensions_estimees doit refléter la géométrie caractéristique (une arche = largeur ~2×hauteur, un obélisque = hauteur ~5×largeur), et elements doit mentionner explicitement "tunnel_voute" / "silhouette_elancee" / "sommet_pyramidal" selon le cas.
- Si l'image ne contient aucun bâtiment identifiable, réponds : {"erreur": "raison courte"}${blocksRule}`;
}

async function analyzeImage(imageBase64, mimeType, { client, maxSize = 64, validBlocks } = {}) {
  const c = client || createClient();
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL_ANALYSE,
      // thinking adaptatif + output_config.effort "high" = raisonnement approfondi,
      // adapté à l'analyse spatiale fine d'une photo architecturale.
      // AUCUN paramètre de sampling (temperature/top_p/top_k) : fable-5 et
      // opus-4-7/4-8 les rejettent avec un 400 "deprecated for this model".
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: systemPrompt(maxSize, validBlocks), cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: 'Analyse ce bâtiment et réponds avec le JSON demandé.' }
        ]
      }]
    })
  );
  if (response.stop_reason === 'max_tokens') {
    console.warn('[vision] analyse tronquée (max_tokens)');
    return { erreur: 'analyse tronquée — photo trop complexe' };
  }
  // avec thinking activé, la réponse contient un bloc 'thinking' à ignorer
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    console.warn(`[vision] réponse sans bloc texte (stop_reason: ${response.stop_reason})`);
    return { erreur: 'réponse vision vide' };
  }
  const rawText = stripCodeFences(textBlock.text).trim();
  // Extraction robuste : on isole le premier objet {...} ; repli sur l'ancienne
  // tolérance « accolade ouvrante omise »
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const text = start >= 0 && end > start
    ? rawText.slice(start, end + 1)
    : (rawText.startsWith('{') ? rawText : `{${rawText}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn('[vision] réponse non-JSON :', text.slice(0, 200));
    return { erreur: 'réponse vision non exploitable' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { erreur: 'réponse vision non exploitable' };
  }
  // vocabulaires fermés : repli si le modèle sort de l'enum
  if (parsed && !parsed.erreur) {
    if (parsed.style && !STYLES.includes(parsed.style)) parsed.style = 'autre';
    if (parsed.toit?.forme && !TOIT_FORMES.includes(parsed.toit.forme)) parsed.toit.forme = 'deux_pans';
  }
  console.log('[vision] description :', JSON.stringify(parsed));
  return parsed;
}

// Boucle de fidélité : compare la photo de référence au rendu voxel généré.
// Renvoie une STRING formatée (rétrocompat generator) dérivée d'un JSON structuré :
// { success: bool, missing: [], excess: [], defects: [], confidence: 0..1 }
// Ce format structuré (inspiré de Voyager critic) rend la correction plus
// actionnable : le generator sait exactement ce qui manque vs ce qui est en trop.
// Retourne null si le rendu est jugé fidèle OU si l'appel critique échoue.
async function compareToPhoto(photoBase64, photoMime, renderBase64, { client } = {}) {
  try {
    const c = client || createClient();
    const response = await withRetry(() => c.messages.create({
      model: MODEL_CRITIQUE,
      max_tokens: 800,
      system: `Tu compares une PHOTO de référence (première image) et le RENDU voxel Minecraft généré à partir d'elle (seconde image).

Ignore les différences inhérentes au format Minecraft : pixellisation, textures des blocs, absence de courbes lisses, simplification des petits détails. Ne compare que ce qui est corrigeable à l'échelle du bloc.

Réponds UNIQUEMENT avec un JSON valide (pas de balises markdown, pas de texte autour). Schéma :

{
  "success": true|false,
  "confidence": 0.0 à 1.0,
  "missing": ["élément CONCRET absent du rendu que la photo montre clairement, avec correction : quoi ajouter et où", ...],
  "excess": ["élément présent dans le rendu qui n'est PAS dans la photo, avec correction : quoi retirer", ...],
  "defects": ["défaut de CONSTRUCTION visible dans le rendu (mur incomplet, trou non voulu, toit inachevé), avec correction", ...]
}

Règles :
- success=true UNIQUEMENT si le rendu est globalement reconnaissable ET sans défaut de construction. Dans ce cas, missing/excess/defects peuvent être vides ou contenir au max 1-2 items mineurs.
- success=false si un élément majeur manque, est en trop, ou si un défaut de construction est visible.
- confidence : ton niveau de certitude sur le verdict success (0.9+ si évident, 0.5 si limite).
- AU PLUS 3 items par catégorie (missing/excess/defects) — les plus importants seulement.
- Chaque item finit par "-> " suivi de la correction concrète.

Exemples d'items :
- missing: "cheminée sur pignon droit visible sur la photo -> ajouter primitive cheminee({x:22, z:5, y_base:12, y_haut:16, materiau:'stone_bricks'})"
- excess: "4ème baie sur la façade principale (photo n'en montre que 3) -> retirer la baie à x=18"
- defects: "tour nord-est ouverte sur sa face arrière -> fermer le cylindre sur 360 degrés"`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: photoMime, data: photoBase64 } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: renderBase64 } },
          { type: 'text', text: 'Compare et retourne le JSON.' }
        ]
      }]
    }), { retries: 1 });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      console.warn(`[vision] critic sans bloc texte (stop_reason: ${response.stop_reason})`);
      return null;
    }
    const rawText = stripCodeFences(textBlock.text).trim();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.warn('[vision] critic JSON non-parsable, ignoré :', rawText.slice(0, 150));
      return null;
    }
    console.log('[vision] critic :', JSON.stringify(parsed));
    // Rendu jugé fidèle → pas de correction
    if (parsed.success === true) return null;
    // Formatte en texte pour le prompt de correction du generator
    const lines = [];
    if (parsed.missing && parsed.missing.length > 0) {
      lines.push('ÉLÉMENTS MANQUANTS (à ajouter) :');
      parsed.missing.forEach((m) => lines.push(`  - ${m}`));
    }
    if (parsed.excess && parsed.excess.length > 0) {
      lines.push('ÉLÉMENTS EN TROP (à retirer) :');
      parsed.excess.forEach((e) => lines.push(`  - ${e}`));
    }
    if (parsed.defects && parsed.defects.length > 0) {
      lines.push('DÉFAUTS DE CONSTRUCTION (à corriger) :');
      parsed.defects.forEach((d) => lines.push(`  - ${d}`));
    }
    if (lines.length === 0) return null;
    return lines.join('\n');
  } catch (err) {
    console.warn('[vision] comparaison photo/rendu indisponible :', err.message);
    return null;
  }
}

module.exports = { analyzeImage, compareToPhoto, STYLES, TOIT_FORMES };

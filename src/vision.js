const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

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
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc" },
  "zone_batiment": { "x": N, "y": N, "largeur": N, "hauteur": N },
  "cadrage": "sujet_seul|scene_complete",
  "environnement": { "vegetation": "...", "arbres": "aucun|epars|dense", "types_arbres": ["chene","sapin","bouleau","acacia"], "sol": "...", "ambiance": "..." }
}

Échelle (règle de calibration, TRÈS important) :
- 1 bloc Minecraft = 1 mètre. Estime les dimensions en mètres réels.
- Repères : une porte ≈ 2 m de haut, un étage de bâtiment ≈ 3 à 4 m, une fenêtre ≈ 1 à 1,5 m, une voiture ≈ 4,5 m de long, un adulte ≈ 1,8 m
- Cohérence obligatoire : hauteur ≈ etages × 4 + hauteur du toit
- Dimensions maximales : ${maxSize} sur chaque axe ; si le bâtiment réel dépasse, réduis toutes les dimensions à l'échelle en conservant les proportions

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
- Si l'image ne contient aucun bâtiment identifiable, réponds : {"erreur": "raison courte"}${blocksRule}`;
}

async function analyzeImage(imageBase64, mimeType, { client, maxSize = 64, validBlocks } = {}) {
  const c = client || createClient();
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0,
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
  // recomposition tolérante (accolade ouvrante parfois omise par le modèle)
  const rawText = stripCodeFences(response.content.find((b) => b.type === 'text').text).trim();
  const text = rawText.startsWith('{') ? rawText : `{${rawText}`;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`réponse vision non-JSON : ${text.slice(0, 200)}`);
  }
  // vocabulaires fermés : repli si le modèle sort de l'enum
  if (parsed && !parsed.erreur) {
    if (parsed.style && !STYLES.includes(parsed.style)) parsed.style = 'autre';
    if (parsed.toit?.forme && !TOIT_FORMES.includes(parsed.toit.forme)) parsed.toit.forme = 'deux_pans';
  }
  console.log('[vision] description :', JSON.stringify(parsed));
  return parsed;
}

// Boucle de fidélité : compare la photo de référence au rendu voxel généré
// et liste les écarts les plus visibles ; null si indisponible (non bloquant)
async function compareToPhoto(photoBase64, photoMime, renderBase64, { client } = {}) {
  try {
    const c = client || createClient();
    const response = await withRetry(() => c.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0,
      system: `Tu compares une PHOTO de référence (première image) et le RENDU voxel Minecraft généré à partir d'elle (seconde image).

Ignore les différences inhérentes au format Minecraft : pixellisation, textures des blocs, absence de courbes lisses, simplification des petits détails. Ne compare que ce qui est corrigeable à l'échelle du bloc.

Liste AU PLUS 5 écarts, uniquement les plus visibles, ceux qui empêchent de reconnaître la photo dans le rendu. Si le rendu est globalement fidèle et sans défaut de construction, réponds uniquement : RAS

Format de chaque écart : une ligne "[CATEGORIE] constat -> correction concrète"
Catégories : [SILHOUETTE] [PROPORTIONS] [TOIT] [OUVERTURES] [COULEUR] [DEFAUT]
[DEFAUT] = défaut de construction visible dans le rendu : tour ou mur incomplet, face manquante, trou non voulu, toit inachevé.

Exemples :
[TOIT] le rendu a un toit plat alors que la photo montre deux pans -> remplacer par un toit deux pans en stairs, faîtage selon l'axe long
[PROPORTIONS] le bâtiment du rendu est trop trapu -> augmenter la hauteur des murs de 3 blocs, réduire la profondeur de 4
[DEFAUT] la tour nord-est est ouverte sur sa face arrière -> fermer le cylindre sur 360 degrés

Pas de compliments, pas d'introduction, uniquement les lignes d'écart ou RAS.`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: photoMime, data: photoBase64 } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: renderBase64 } },
          { type: 'text', text: 'Écarts entre la photo (référence) et le rendu :' }
        ]
      }]
    }), { retries: 1 });
    const text = response.content.find((b) => b.type === 'text').text.trim();
    // RAS (tolérant) = rendu fidèle : rien à corriger
    if (/^ras\.?$/i.test(text)) return null;
    return text;
  } catch (err) {
    console.warn('[vision] comparaison photo/rendu indisponible :', err.message);
    return null;
  }
}

module.exports = { analyzeImage, compareToPhoto, STYLES, TOIT_FORMES };

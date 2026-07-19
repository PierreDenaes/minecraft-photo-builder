const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

function systemPrompt(maxSize, validBlocks) {
  const blocksRule = validBlocks
    ? `\n- Choisis les valeurs de palette_blocs et materiau_suggere UNIQUEMENT dans cette liste : ${validBlocks.join(', ')}`
    : '';
  return `Tu analyses une photo de bâtiment pour un constructeur Minecraft (version 1.20).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown.

Schéma attendu :
{
  "type_batiment": "...",
  "style": "...",
  "dimensions_estimees": { "largeur": N, "profondeur": N, "hauteur": N },
  "etages": N,
  "toit": { "forme": "...", "materiau_suggere": "bloc_minecraft" },
  "elements": ["..."],
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc" },
  "zone_batiment": { "x": N, "y": N, "largeur": N, "hauteur": N },
  "cadrage": "sujet_seul|scene_complete",
  "environnement": { "vegetation": "...", "arbres": "aucun|epars|dense", "types_arbres": ["chene","sapin"], "sol": "...", "ambiance": "..." }
}

Règles :
- Tous les blocs doivent être des noms Minecraft 1.20 valides (snake_case, sans préfixe minecraft:)
- Dimensions maximales : ${maxSize} sur chaque axe
- Mappe les couleurs/matériaux réels vers les blocs les plus proches
- zone_batiment : rectangle englobant du bâtiment principal en POURCENTAGES (0-100) de l'image, x/y = coin haut-gauche ; omets ce champ s'il n'y a pas de bâtiment net
- cadrage : "sujet_seul" si l'image montre UN sujet principal sans environnement significatif (bâtiment isolé, objet, personne), "scene_complete" si le décor fait partie du sujet (paysage, terrain, jardin)
- environnement : décris TOUJOURS la végétation (densité d'arbres : aucun/epars/dense, essences parmi chene/sapin), la nature du sol et l'ambiance générale de la scène
- Si l'image ne contient aucun bâtiment identifiable, réponds : {"erreur": "raison courte"}${blocksRule}`;
}

async function analyzeImage(imageBase64, mimeType, { client, maxSize = 64, validBlocks } = {}) {
  const c = client || createClient();
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt(maxSize, validBlocks),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: 'Analyse ce bâtiment et réponds avec le JSON demandé.' }
        ]
      }]
    })
  );
  const text = stripCodeFences(response.content.find((b) => b.type === 'text').text);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`réponse vision non-JSON : ${text.slice(0, 200)}`);
  }
  console.log('[vision] description :', JSON.stringify(parsed));
  return parsed;
}

module.exports = { analyzeImage };

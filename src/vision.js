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
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc" }
}

Règles :
- Tous les blocs doivent être des noms Minecraft 1.20 valides (snake_case, sans préfixe minecraft:)
- Dimensions maximales : ${maxSize} sur chaque axe
- Mappe les couleurs/matériaux réels vers les blocs les plus proches
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

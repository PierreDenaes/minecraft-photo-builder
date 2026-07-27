const REFINE_MODEL = 'claude-haiku-4-5-20251001';

const REFINE_SYSTEM = `Reformule la demande utilisateur en une requête Google Images optimisée pour trouver UNE photo utilisable pour reconstruire un bâtiment en Minecraft. Ajoute "photo diurne, façade complète" si absent. Désambiguïse les noms propres. Sortie : la requête reformulée, RIEN d'autre.`;

async function refineQuery(userText, { client }) {
  if (!client) throw new Error('refineQuery : client Anthropic manquant');
  try {
    const response = await client.messages.create({
      model: REFINE_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: REFINE_SYSTEM,
      messages: [{ role: 'user', content: `Reformule : "${userText}"` }]
    });
    const raw = response.content.find((b) => b.type === 'text').text.trim();
    if (!raw) return userText;
    return raw.slice(0, 200);
  } catch (err) {
    console.warn('[websearch] refineQuery échec :', err.message);
    return userText;
  }
}

module.exports = { refineQuery };

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

async function searchImages(refinedQuery, { apiKey, n = 8, fetchFn = fetch } = {}) {
  if (!apiKey) throw new Error('searchImages : apiKey manquant (SERPAPI_KEY absente)');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_images');
  url.searchParams.set('q', refinedQuery);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('num', String(Math.max(n, 10)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetchFn(url.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`SerpAPI HTTP ${response.status}`);
  const json = await response.json();
  const results = json.images_results || [];
  return results
    .filter((r) => r.original && !/\.(svg|gif)(\?|$)/i.test(r.original))
    .slice(0, n)
    .map((r) => ({
      url: r.original,
      thumbnail: r.thumbnail,
      title: r.title || '',
      source: r.source || ''
    }));
}

module.exports = { refineQuery, searchImages };

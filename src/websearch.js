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

const PICK_MODEL = 'claude-haiku-4-5-20251001';

const PICK_SYSTEM = `Tu compares N photos candidates pour une reconstruction Minecraft. Retourne UNIQUEMENT le NUMÉRO (1..N) de la meilleure photo, OU le mot "aucune" si toutes sont inutilisables.

Bonne photo : diurne, façade complète, bâtiment centré, pas de foule, pas de texte overlay, pas de watermark, pas de dessin, pas de plan.
Inutilisable : dessin, plan technique, screenshot de jeu vidéo, photo de nuit sans détail, portrait de personne, gros plan sur un détail.`;

async function pickBest(candidates, { client, fetchFn = fetch } = {}) {
  if (!candidates || candidates.length === 0) return null;
  if (!client) throw new Error('pickBest : client Anthropic manquant');
  // télécharge chaque thumbnail en base64 ; survivors garde la correspondance image → candidate
  const images = [];
  const survivors = [];
  for (const c of candidates) {
    try {
      const resp = await fetchFn(c.thumbnail);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      const mimeType = resp.headers.get('content-type') || 'image/jpeg';
      images.push({ base64: buf.toString('base64'), mimeType });
      survivors.push(c);
    } catch { /* ignore, on continue avec les autres */ }
  }
  if (images.length === 0) return null;
  const userContent = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType, data: img.base64 }
  }));
  userContent.push({ type: 'text', text: 'Choisis.' });
  const response = await client.messages.create({
    model: PICK_MODEL,
    max_tokens: 20,
    temperature: 0,
    system: PICK_SYSTEM,
    messages: [{ role: 'user', content: userContent }]
  });
  const raw = response.content.find((b) => b.type === 'text').text.trim().toLowerCase();
  if (raw === 'aucune') return null;
  const num = parseInt(raw, 10);
  if (!Number.isInteger(num) || num < 1 || num > images.length) return null;
  return survivors[num - 1];
}

module.exports = { refineQuery, searchImages, pickBest };

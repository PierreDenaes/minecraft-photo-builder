const REFINE_MODEL = 'claude-haiku-4-5-20251001';

const REFINE_SYSTEM = `Reformule la demande utilisateur en une requête Google Images optimisée pour trouver UNE photo utilisable pour reconstruire une scène en Minecraft. Adapte les mots-clés au TYPE de sujet :

- BÂTIMENT MONUMENTAL identifiable (chateau, monument, tour, arche, cathédrale, villa, maison) → ajoute "photo diurne, façade complète, bâtiment centré"
- COMPLEXE ou SCÈNE (parc aquatique, jardin, place, campus, port, zoo) → ajoute "vue d'ensemble, plan large, photo aérienne ou de face" (pas "façade complète" qui exclurait les vues drone)
- OBJET ISOLÉ (voiture, statue, sculpture) → ajoute "photo studio, fond neutre"

Désambiguïse les noms propres (ex: "aqualand" → "Aqualand Sainte-Maxime parc aquatique"). Sortie : la requête reformulée, RIEN d'autre.`;

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

Bonne photo (préfère dans cet ordre) :
- Bâtiment/monument identifiable OU complexe complet visible, photo diurne, sujet centré et cadré
- Vue d'ensemble (drone, façade, plan large) acceptée pour les complexes (parc aquatique, jardin, port, place, campus, zoo)
- Une foule modérée ou quelques personnes est OK si le sujet architectural reste dominant

Inutilisable UNIQUEMENT si :
- Dessin, plan technique, capture d'écran de jeu vidéo, image générée IA visible
- Photo de nuit floue sans détail
- Portrait humain dominant (visage plus grand que le décor)
- Gros plan sur un détail isolé (une porte, un toboggan seul, une statue isolée)
- Texte/watermark occupant plus de 20% de l'image

Si aucune candidate n'est parfaite mais qu'au moins UNE montre le sujet demandé de façon reconnaissable, choisis la MEILLEURE plutôt que "aucune".`;

async function pickBest(candidates, { client, fetchFn = fetch } = {}) {
  if (!candidates || candidates.length === 0) return null;
  if (!client) throw new Error('pickBest : client Anthropic manquant');
  // Téléchargement parallèle des thumbnails avec timeout individuel 5 s :
  // séquentiel + sans timeout bloquait indéfiniment sur Google Images (undici
  // finit par abort avec "This operation was aborted", propagé à l'utilisateur).
  async function downloadOne(c) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const resp = await fetchFn(c.thumbnail, { signal: ctrl.signal });
      if (!resp.ok) return null;
      // un serveur qui répond du HTML au lieu d'une image ferait échouer l'appel
      // vision (400) et donc tout le !build : on l'écarte comme candidat
      const mimeType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!mimeType.startsWith('image/')) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      return { image: { base64: buf.toString('base64'), mimeType }, candidate: c };
    } catch { return null; }
    finally { clearTimeout(t); }
  }
  const results = await Promise.all(candidates.map(downloadOne));
  const images = [];
  const survivors = [];
  for (const r of results) {
    if (!r) continue;
    images.push(r.image);
    survivors.push(r.candidate);
  }
  if (images.length === 0) return null;
  const userContent = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType, data: img.base64 }
  }));
  userContent.push({ type: 'text', text: 'Choisis.' });
  const response = await client.messages.create({
    model: PICK_MODEL,
    // 100 tokens : Haiku ajoute parfois markdown/justification ("**2**\n\nLa photo 2 est...")
    // malgré la consigne. Parsing tolérant en aval récupère le premier nombre.
    max_tokens: 100,
    temperature: 0,
    system: PICK_SYSTEM,
    messages: [{ role: 'user', content: userContent }]
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    console.warn(`[websearch] pickBest sans bloc texte (stop_reason: ${response.stop_reason})`);
    return null;
  }
  const raw = textBlock.text.trim().toLowerCase();
  // Parsing tolérant : Haiku ajoute parfois du markdown (**2**) ou justifie sa réponse
  // ("2\nLa photo 2 est..."). On extrait le premier nombre trouvé, ou "aucune" si présent.
  if (/\baucune\b/.test(raw)) return null;
  const match = raw.match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  if (!Number.isInteger(num) || num < 1 || num > images.length) return null;
  return survivors[num - 1];
}

module.exports = { refineQuery, searchImages, pickBest };

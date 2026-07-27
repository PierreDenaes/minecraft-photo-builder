# Design : Itération 20 — `!build <texte>` via recherche web

Date : 2026-07-27 — Base : main après I19 (mémoire auto-améliorante)

## Origine

Pierre : « pourrait-on lui donner la possibilité de trouver les ressources visuelles lui-même sur le web pour construire la demande ». Après I19, `!photo` marche bien mais impose au joueur d'avoir déjà une photo. Objectif de I20 : le joueur tape juste `!build chateau de disney` dans le chat, le bot cherche une image sur le web, sélectionne la meilleure et lance le pipeline photo existant. Zéro upload nécessaire pour les cas connus.

## Principe

Trois étapes en amont du pipeline photo existant :

1. **Reformulation** — Claude Haiku prend `chateau de disney` et retourne `chateau de la belle au bois dormant Disneyland Paris, photo diurne, façade complète, sans foule`
2. **Recherche** — SerpAPI Google Images retourne 8 candidats (URL + thumbnail + titre)
3. **Sélection** — Claude Haiku vision compare les 8 thumbnails et retourne l'index de la meilleure OU `null` si aucune n'est utilisable

Ensuite : téléchargement du buffer image, appel de `onPhoto(username, buffer, mimeType)` — le pipeline existant (vision Opus 4.7 thinking + generator + mémoire I19 + construction) est inchangé.

## Nouveau module `src/websearch.js`

Trois fonctions publiques :

```js
async function refineQuery(userText, { client })
// Retourne une requête enrichie prête pour SerpAPI.
// Fallback si Haiku échoue : retourne userText tel quel.

async function searchImages(refinedQuery, { apiKey, n = 8 })
// Appel HTTPS à SerpAPI (engine=google_images).
// Retourne [{ url, thumbnail, title, source }, ...] filtré (pas de .svg/.gif).
// Throw si apiKey manquant ou HTTP ≠ 200.

async function pickBest(candidates, { client })
// Envoie les N thumbnails à Haiku vision.
// Retourne l'index (1-based) de la meilleure candidate, OU null si aucune utilisable.
```

## Handler `!build <texte>` dans `src/chat.js`

```js
if (cmd.startsWith('!build ')) {
  const userText = cmd.slice(7).trim();
  if (!userText) {
    bot.chat(`${username} : !build attend une description, ex: !build chateau de disney`);
    return;
  }
  onBuild(username, userText).catch((err) => {
    bot.chat(`${username} : erreur !build : ${err.message}`);
  });
  return;
}
```

`onBuild` est un nouveau handler exporté depuis `index.js`, injecté au bot comme les autres (onPhoto, onSchema, onDiorama).

## `onBuild` dans `src/index.js`

```js
async function onBuild(username, userText) {
  bot.chat(`${username} : recherche "${userText}" sur le web...`);

  const refined = await refineQuery(userText, { client: apiClient });
  const candidates = await searchImages(refined, { apiKey: process.env.SERPAPI_KEY, n: cfg.web_search.n_results });

  if (candidates.length === 0) {
    bot.chat(`${username} : aucune image trouvée pour "${userText}". Réessaie avec une description plus précise.`);
    return;
  }

  const bestIdx = await pickBest(candidates, { client: apiClient });
  if (bestIdx === null) {
    bot.chat(`${username} : aucune photo utilisable parmi les ${candidates.length} résultats. Réessaie plus précis, ex: "chateau disneyland paris facade jour".`);
    return;
  }

  const chosen = candidates[bestIdx - 1];
  bot.chat(`Photo trouvée : ${chosen.url}`);
  bot.chat('Analyse en cours (~1 min)...');

  const response = await fetch(chosen.url);
  if (!response.ok) throw new Error(`téléchargement image HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') || 'image/jpeg';

  return onPhoto(username, buffer, mimeType);
}
```

## Format SerpAPI

Endpoint : `https://serpapi.com/search.json?engine=google_images&q=<query>&api_key=<key>&num=10`

Extraction :
```js
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
```

## Prompt Haiku pour `pickBest`

System :
```
Tu compares N photos candidates pour une reconstruction Minecraft. Retourne UNIQUEMENT le NUMÉRO (1..N) de la meilleure photo, OU le mot "aucune" si toutes sont inutilisables.

Bonne photo : diurne, façade complète, bâtiment centré, pas de foule, pas de texte overlay, pas de watermark, pas de dessin, pas de plan.
Inutilisable : dessin, plan technique, screenshot de jeu vidéo, photo de nuit sans détail, portrait de personne, gros plan sur un détail.
```

User content : les N thumbnails en `image/base64` (téléchargées puis converties). Aucun texte user autre que "Choisis."

Parse :
- Match `/^([1-9]|[1-9][0-9])$/` → int
- Match `/^aucune$/i` → null
- Autre → warn + retourne null (sécurité)

## Prompt Haiku pour `refineQuery`

System :
```
Reformule la demande utilisateur en une requête Google Images optimisée pour trouver UNE photo utilisable pour reconstruire un bâtiment en Minecraft. Ajoute "photo diurne, façade complète" si absent. Désambiguïse les noms propres. Sortie : la requête reformulée, RIEN d'autre.
```

User : `Reformule : "<userText>"`

Parse : trim, garde ≤ 200 caractères. Fallback si vide → userText original.

## Config

Ajouter dans `config.json` :
```json
{
  ...,
  "web_search": {
    "n_results": 8,
    "min_image_size": 400
  }
}
```

`min_image_size` : filtre local sur `original_width` / `original_height` SerpAPI (skip si les deux < 400px). Évite les icônes miniatures.

## Variables d'environnement

Nouveau : `SERPAPI_KEY` — clé personnelle de Pierre (déjà obtenue, 250 recherches gratuites/mois). Lecture via `process.env`, jamais commité.

## Gestion des erreurs

| Cas | Message chat |
|-----|--------------|
| `!build` sans texte | `!build attend une description, ex: !build chateau de disney` |
| `SERPAPI_KEY` absente | `SERPAPI_KEY absente de l'env — configure-la et réessaie` |
| SerpAPI HTTP ≠ 200 | `erreur SerpAPI (HTTP N)` |
| SerpAPI 0 résultat | `aucune image trouvée pour "<texte>". Réessaie plus précis.` |
| pickBest retourne null | `aucune photo utilisable parmi les N résultats. Réessaie plus précis, ex: "chateau disneyland paris facade jour".` |
| Download image échoue | `téléchargement image HTTP N` (via `onBuild.catch` dans chat.js) |
| Timeout global | (via AbortController 30s sur fetch) — `timeout recherche web` |

## Timeouts

- refineQuery : 10s (client Anthropic natif)
- searchImages : 15s (`AbortController` custom)
- pickBest : 15s (client Anthropic natif)
- Download image : 10s (`AbortController`)

Total budget d'échec : ~50s. Au-delà, le joueur reçoit un message clair.

## Tests

Nouveau fichier `test/websearch.test.js` :

1. `refineQuery reformule via Haiku (mock)` — vérifie l'appel client + parsing sortie
2. `refineQuery fallback userText si Haiku vide` — client mock retourne "", sortie = userText
3. `searchImages sans clé API → throw explicite`
4. `searchImages parse une fixture SerpAPI` — fixture JSON à `test/fixtures/serpapi-response.json`
5. `searchImages filtre les .svg/.gif`
6. `pickBest retourne l'index parsé (mock Claude vision)` — client mock retourne "3", sortie = 3
7. `pickBest retourne null si Claude répond "aucune"`
8. `pickBest retourne null si sortie non-parsable`

Modifications aux tests existants :
- `test/chat.test.js` : nouveau test — `!build sans texte` → message d'erreur ; `!build chateau` appelle `onBuild` avec le texte extrait

`onBuild` (fonction d'orchestration dans index.js) est testable via mocks composés mais lourd — testé indirectement par les tests unitaires de ses trois briques et par un test manuel en jeu.

Fixtures : `test/fixtures/serpapi-response.json` avec 3-4 résultats représentatifs (URLs bidons vers example.com).

## Intégration avec la mémoire I19

Automatique : `onBuild` appelle `onPhoto(username, buffer, mimeType)` avec le buffer téléchargé du web. Le pipeline `onPhoto` capture déjà `{photo, description, code}` à `!go` via `memory.saveCase`. Aucun code spécifique — la photo web est traitée comme une photo uploadée du point de vue mémoire.

Effet secondaire souhaité : quand le joueur `!build`ra le même sujet plus tard, la mémoire retrouvera la construction passée par similarité visuelle CLIP.

## Ce qu'on ne fait pas (YAGNI explicite)

- **Cache des recherches web** : 250 requêtes/mois suffisent large ; SerpAPI est rapide
- **Vérification de licence/droits d'image** : usage local privé, pas de publication
- **Historique des recherches** : la mémoire capture déjà la photo trouvée + description structurée
- **UI web pour visualiser les 8 candidates** : lien direct dans le chat suffit
- **Multi-tentative auto si pickBest null** : message d'erreur + suggestion, joueur reformule
- **Support d'autres moteurs (Bing, DuckDuckGo)** : SerpAPI est le contrat, wrapper multi-source non nécessaire
- **Suggestion automatique de reformulation** : le message d'erreur donne un exemple, pas de LLM en boucle
- **Pagination SerpAPI** : 8 résultats suffisent, on ne va pas paginer

## Coût par requête `!build`

- Refine (Haiku 4.5) : ~$0.001
- Search (SerpAPI) : gratuit dans le quota 250/mois
- PickBest (Haiku 4.5 vision, 8 thumbnails) : ~$0.005
- Pipeline photo existant (Opus 4.7 thinking + generator + décorateur) : ~$0.10-0.20

Total : ~$0.10-0.20 par `!build` réussi, dominé par le pipeline existant. Négligeable pour un projet perso.

## Ordre de priorité pour l'implémentation

1. Module `websearch.js` complet + tests unitaires (mock Claude + fixture SerpAPI)
2. Config `web_search` + lecture `SERPAPI_KEY`
3. `onBuild` dans `index.js` + câblage `!build` dans `chat.js`
4. Tests d'intégration chat.js
5. Test manuel en jeu : `!build chateau de disney` → vérifier photo trouvée → `!go` → construction → cas mémoire capturé

## Effets attendus

- Le joueur peut construire des bâtiments célèbres sans photo (Tour Eiffel, Colisée, chateau de Disney, Empire State, etc.)
- La mémoire s'enrichit naturellement — après quelques `!build`, les futures constructions du même sujet bénéficient du few-shot mémoire
- Latence supplémentaire vs `!photo` upload : ~10-15s en amont du pipeline (refine + search + pick). Acceptable.
- Erreurs claires quand le web ne trouve rien d'utilisable — pas de silent failure ni de merde construite en jeu

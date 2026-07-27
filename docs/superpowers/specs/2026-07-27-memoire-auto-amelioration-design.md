# Design : Itération 19 — Mémoire auto-améliorante par cas notés

Date : 2026-07-27 — Base : main après I18 (fix dalle-flush)

## Origine

Pierre : « peut-on donner une mémoire à l'agent et qu'il s'améliore de lui-même de tour en tour ». Après I18, le pipeline photo→construction est solide mais chaque appel repart de zéro : aucune capitalisation sur les rendus passés. Objectif de I19 : capturer chaque construction confirmée, la faire noter par le joueur, et injecter les meilleurs cas passés en few-shot lors des générations suivantes. Le LLM ne se fine-tune pas (impossible sans coût), mais il voit du code concret qui a marché sur une photo similaire.

## Principe

Trois moments :

1. **À `!go`** : capture automatique du cas `{photo, description_vision, code_généré}` dans `data/memoire/cases/`. Retourne un `buildId`.
2. **À `!note N`** (nouvelle commande) : le joueur note la construction de 1 à 5. La note est écrite dans le cas et dans l'index.
3. **Au prochain `!photo`** : recherche des 2-3 cas passés les plus similaires visuellement (embedding CLIP) et bien notés (≥ 3/5). Le code de ces cas est injecté en few-shot en fin de system prompt du generator.

Aucun cas n'est perdu : les non-notés restent en base pour analyse future, seule la sélection filtre.

## Nouveau module `src/memory.js`

Trois fonctions publiques :

```js
async function warmup()
// Charge le modèle CLIP (~150 MB) en tâche de fond au démarrage.
// Non-bloquant : le bot marche même si le chargement échoue (fallback métadonnées).

async function saveCase({ photo, description, code })
// Écrit trois fichiers dans data/memoire/cases/<id>.{json,jpg,emb} :
//   .json = { id, date, style, type_batiment, description, code, note: null }
//   .jpg  = miniature 256px (via sharp, déjà dépendance)
//   .emb  = Float32Array embedding CLIP (sérialisé Buffer)
// Met à jour data/memoire/index.json.
// Retourne l'id (ex: '2026-07-27-a3f2').

async function updateNote(id, note)
// Vérifie note ∈ [1,5], met à jour <id>.json + index.json.
// Silent no-op si l'id n'existe pas (pas d'erreur, juste un console.warn).

async function findSimilar(photo, description, opts = {})
// opts = { n = 3, minNote = 3, minSimilarity = 0.5 }
// Retourne un array trié par similarité desc, taille ≤ n :
//   [{ id, similarity, note, description, code }, ...]
// Fallback si CLIP indispo : filtre index par style+type_batiment, tri par note desc.
```

## Structure de stockage

```
data/memoire/
├── index.json                     ← liste légère pour scan rapide
└── cases/
    ├── 2026-07-27-a3f2.json       ← { id, date, style, type_batiment, description, code, note }
    ├── 2026-07-27-a3f2.jpg        ← miniature 256px (JPEG, qualité 80)
    └── 2026-07-27-a3f2.emb        ← Float32Array 512 dims (Buffer, ~2 KB)
```

Format `index.json` :

```json
[
  { "id": "2026-07-27-a3f2", "date": "2026-07-27T14:32:00Z", "style": "medieval", "type_batiment": "maison", "note": 4 }
]
```

L'index sert à trouver rapidement les candidats sans lire tous les JSON. L'embedding se charge du disque uniquement pour les candidats retenus par le filtre métadonnées de premier niveau.

Un cas = trois fichiers pour trois raisons :
- JSON lisible/éditable à la main (inspection, debug)
- JPG affichable dans un navigateur
- EMB en binaire compact (Float32Array direct, pas de parsing JSON de 512 flottants)

## Format d'id

`YYYY-MM-DD-<4 hex random>` — trié naturellement par date, unique en pratique. Pas d'UUID (trop long pour peu d'utilité vu le volume attendu, ~1 construction par session).

## Intégration au pipeline existant

### `src/index.js`

- Au boot : `memory.warmup().catch(err => console.warn('[memory] CLIP indispo :', err.message))`
- Dans `onPhoto`, juste après `analyzeImage` et avant `generateStructure` :
  ```js
  const inspiration = await memory.findSimilar(buffer, description, { n: 3, minNote: 3 });
  const genOpts = { ..., inspiration };
  ```

### `src/generator.js`

`generateStructure` accepte déjà un champ `inspiration` (utilisé par le mode schemas RAG). On étend le format pour accepter aussi les cas mémoire. Format transmis au LLM en fin de system prompt :

```
Cas passés similaires (notés ≥ 3/5) — inspire-toi de leur composition :

--- Cas 1 (note 5/5, similarité 0.87, style medieval) ---
Description : maison bretonne à colombages, toit ardoise 2 pans...
Code :
function generateStructure() {
  const corps = boite({ x1: 0, z1: 0, x2: 12, z2: 8, ... });
  ...
}

--- Cas 2 (note 4/5, similarité 0.72, style medieval) ---
...
```

Si `inspiration` est vide (base neuve ou aucun cas ne passe le filtre), le prompt reste identique à l'actuel. Dégradation silencieuse.

### `src/chat.js`

- Dans le handler `!go` : appelle `memory.saveCase({...})` juste avant `builder.startBuild`, stocke le `buildId` dans `pending.buildId`.
- Après la construction, `lastBuild.buildId` retient l'id du dernier cas capturé (pour la commande `!note` qui suit).
- Nouvelle commande `!note <N>` avec `N ∈ [1..5]` : appelle `memory.updateNote(lastBuild.buildId, N)`, répond dans le chat "Note enregistrée : 4/5, merci !" ou "Aucune construction récente à noter".

## Dépendances nouvelles

- `@xenova/transformers` — CLIP en local, ~150 MB modèle téléchargé au premier démarrage. Cache dans `~/.cache/huggingface/` (par défaut). Aucune clé API.
- `sharp` — déjà installé pour d'autres usages (voxeliseur, portrait). Utilisé pour miniature 256px.

Package.json ajouté :

```json
{
  "dependencies": {
    "@xenova/transformers": "^2.x"
  }
}
```

## Seuils par défaut

- `n = 3` cas injectés — 2 c'est maigre, 4 dilue le prompt
- `minNote = 3/5` — permissif au démarrage (sinon avec peu de cas notés 4-5 on n'a rien à injecter)
- `minSimilarity = 0.5` — cosine similarity CLIP en dessous → photos vraiment différentes, ne pas injecter un hors-sujet même bien noté

Ces seuils sont des constantes dans `memory.js` (pas encore en config). Ajustables si besoin après itération.

## Comportement au premier démarrage

1. Bot démarre → `memory.warmup()` déclenche le téléchargement de CLIP (~150 MB, 30-60s sur bonne connexion)
2. Pendant ce temps, `findSimilar` retourne `[]` (fallback silencieux)
3. Une fois warmup terminé, le bot log `[memory] CLIP prêt`
4. Cas suivants : embeddings calculés normalement

Si le téléchargement échoue (offline, disque plein) : bot marche en mode dégradé permanent (findSimilar utilise le fallback métadonnées). Message chat au joueur : rien. Log console : warning.

## Tests

Nouveau fichier `test/memory.test.js` :

1. `saveCase → crée les 3 fichiers, retourne un id, met à jour index.json`
2. `updateNote → modifie la note dans le JSON du cas et dans l'index`
3. `updateNote sur id inexistant → no-op silencieux`
4. `findSimilar sans cas en base → retourne []`
5. `findSimilar filtre par minNote (cas note=2 exclu si seuil=3)`
6. `findSimilar filtre par minSimilarity (cas trop éloigné exclu)`
7. `findSimilar retourne au plus n cas, triés par similarité desc`
8. `findSimilar sans CLIP disponible → fallback métadonnées (filtre style+type_batiment, tri note desc)`

CLIP mocké dans les tests via injection : `memory.__setEmbedder(fn)` permet de remplacer l'embedder par une fonction déterministe pour les tests (embedding = hash du buffer). Aucun téléchargement en CI.

Fixtures : 2-3 JPEG 32×32 dans `test/fixtures/memory/`.

Modifications aux tests existants :
- `test/chat.test.js` : nouveau test — `!note 4` met à jour la note du dernier build
- `test/generator.test.js` : nouveau test — `inspiration` contenant des cas mémoire produit un system prompt avec le bloc "Cas passés similaires"

## Ce qu'on ne fait pas (YAGNI explicite)

- **UI d'édition** : suppression/modification à la main dans les fichiers si besoin
- **Compression** : 100-1000 cas restent triviaux (< 100 MB)
- **Auto-nettoyage** : les cas mal notés restent en base pour analyse future
- **Partage inter-installations** : chaque bot a sa mémoire locale
- **Extraction de règles distillées** : format B de la question 6 (LLM qui lit les cas et en extrait des règles) — trop de maillons fragiles au début
- **Recherche hybride métadonnées + CLIP** : le CLIP seul suffit pour <200 cas ; on ajoutera un pré-filtre par style si besoin après itération

## Rétrocompatibilité

Format `case.json` v1 (implicite, pas de champ `version`). Si futurs champs ajoutés (ex: `defauts_audit`, `render_final`) → `case.defauts_audit ?? []` à la lecture, pas de migration lourde. Les vieux cas restent valides.

## Ordre de priorité pour l'implémentation

1. Module `memory.js` complet + tests unitaires (mock CLIP)
2. Intégration `chat.js` (`!go` sauve, `!note` met à jour)
3. Intégration `index.js` + `generator.js` (findSimilar + few-shot)
4. Test manuel en jeu : construire 3-4 maisons, noter, construire une 5ᵉ similaire, vérifier que le prompt final contient bien le bloc "Cas passés similaires"

## Effets attendus

- Le prompt du generator gagne ~500-1500 tokens (2-3 blocs de code). Coût API augmenté de ~5%. Négligeable.
- La latence de `!photo` augmente de ~500ms (calcul embedding CLIP de la nouvelle photo + cosine similarity contre l'index). Acceptable.
- La qualité des constructions doit s'améliorer sur les styles récurrents (maisons bretonnes, villas modernes) à mesure que la base grandit. Effet mesurable après ~20 constructions notées du même style.

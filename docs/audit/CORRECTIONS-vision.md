# Plan de correction : src/vision.js

Contexte : audit du 27/07/2026 (fichier 4/13). Décision de Pierre : les modèles actuels sont les bons (`MODEL_ANALYSE = 'claude-fable-5'`, `MODEL_CRITIQUE = 'claude-opus-4-7'`), NE PAS les changer. Le point 1 met seulement le commentaire en cohérence.

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. Mettre à jour le commentaire de choix des modèles (PAS les constantes)

Remplacer le bloc de commentaire au-dessus de `MODEL_ANALYSE` (celui qui parle d'« Opus pour l'analyse principale » et de « compareToPhoto reste sur sonnet ») par :
```js
// Analyse principale sur fable-5 (compréhension spatiale + coût contenu).
// Critique compareToPhoto sur opus-4-7 : le verdict photo↔rendu conditionne
// les tours de correction, on privilégie la fiabilité du jugement malgré
// les 2 appels par pipeline.
```
Ne modifier NI `MODEL_ANALYSE` NI `MODEL_CRITIQUE`.

## 2. Garde sur le bloc texte des réponses API

Dans `analyzeImage`, remplacer :
```js
const rawText = stripCodeFences(response.content.find((b) => b.type === 'text').text).trim();
```
par :
```js
const textBlock = response.content.find((b) => b.type === 'text');
if (!textBlock) {
  console.warn(`[vision] réponse sans bloc texte (stop_reason: ${response.stop_reason})`);
  return { erreur: 'réponse vision vide' };
}
const rawText = stripCodeFences(textBlock.text).trim();
```

Dans `compareToPhoto`, remplacer la ligne équivalente par :
```js
const textBlock = response.content.find((b) => b.type === 'text');
if (!textBlock) {
  console.warn(`[vision] critic sans bloc texte (stop_reason: ${response.stop_reason})`);
  return null;
}
const rawText = stripCodeFences(textBlock.text).trim();
```

## 3. Vérifier stop_reason dans analyzeImage

Juste après l'obtention de `response` (avant l'extraction du texte), ajouter :
```js
if (response.stop_reason === 'max_tokens') {
  console.warn('[vision] analyse tronquée (max_tokens)');
  return { erreur: 'analyse tronquée — photo trop complexe' };
}
```

## 4. Compléter le schéma JSON du prompt d'analyse

Problème : les règles du prompt et le générateur exploitent `travees` et `palette_blocs.accents/menuiseries/exterieur`, mais le schéma affiché ne les contient pas : le modèle peut les omettre.

Dans `systemPrompt`, remplacer dans le schéma :
```
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc" },
```
par :
```
  "palette_blocs": { "murs": "bloc", "toit": "bloc", "fondation": "bloc", "accents": "bloc", "menuiseries": "bloc", "exterieur": "bloc" },
  "travees": { "facade_principale": N, "autres_facades": N },
```

## 5. Extraction JSON robuste + retour {erreur} au lieu de throw

Problème : le hack `{${rawText}` casse si le modèle préfixe du texte, et le throw sur non-JSON court-circuite le chemin d'erreur propre d'index.js (`description.erreur` → message en jeu).

Dans `analyzeImage`, remplacer :
```js
const text = rawText.startsWith('{') ? rawText : `{${rawText}`;
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  throw new Error(`réponse vision non-JSON : ${text.slice(0, 200)}`);
}
```
par :
```js
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
```
Note : les appelants (index.js) testent déjà `description.erreur` partout, ce changement emprunte donc le chemin d'erreur existant. Vérifier qu'aucun appelant ne dépend du throw (grep `analyzeImage` : onDiorama, onSchema, onPhoto, onModel — tous testent `.erreur` ou l'équivalent).

---

## Annexe : options NON validées (à décider plus tard)

- `confidence` du critic est parsé mais inutilisé : possibilité d'ignorer les critiques avec `confidence < 0.5` pour éviter des tours de correction sur verdict incertain.
- `analyzeImage` sans clé API crashe avec l'erreur brute de `createClient` (index.js ne lui passe pas son apiClient). Option : passer `client: apiClient` depuis index.js et gérer null par un `{ erreur: 'clé API manquante' }`.

---

## Vérification finale

1. `node -e "require('./src/vision.js')"` charge sans erreur.
2. Test unitaire rapide de l'extraction (sans appel API) : extraire la logique en local ou vérifier mentalement les cas : `'{"a":1}'`, `'Voici : {"a":1}'`, `'"a":1}'` (accolade omise) → tous parsés.
3. Test manuel !photo : la description contient `travees` et `palette_blocs.menuiseries` dans le log `[vision] description`.
4. Test manuel avec une image sans bâtiment (photo de chat) : message d'erreur propre en jeu, pas de crash.

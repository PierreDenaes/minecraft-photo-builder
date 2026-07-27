# Plan de correction : src/generator.js (+ src/llm.js)

Contexte : audit du 27/07/2026. Applique les corrections dans l'ordre. Les points 1 à 6 sont prioritaires (fiabilité), 7 à 12 sont des améliorations, 13 et 14 sont optionnels.

Règle générale : ne change AUCUN comportement fonctionnel non listé ici. Les erreurs levées à l'intérieur du `try` de la boucle de tentatives de `generateStructure()` sont réinjectées au LLM : c'est voulu, formule donc des messages d'erreur descriptifs et actionnables.

---

## 1. Garde sur le bloc texte de la réponse API

Fichier : `src/generator.js`, dans `generateStructure()` (~ligne 371).

Remplacer :
```js
const raw = response.content.find((b) => b.type === 'text').text;
```
par :
```js
const textBlock = response.content.find((b) => b.type === 'text');
if (!textBlock) {
  throw new Error(`réponse LLM sans bloc texte (stop_reason: ${response.stop_reason})`);
}
const raw = textBlock.text;
```

## 2. Validation stricte + clonage en une passe (remplace le JSON.parse/stringify)

Fichier : `src/generator.js`.

Ajouter une fonction `sanitizeBlocks` :
```js
// Valide et clone chaque bloc hors du realm VM en une seule passe
// (remplace JSON.parse(JSON.stringify(...)), coûteux sur de grosses structures)
function sanitizeBlocks(result) {
  const blocks = new Array(result.length);
  for (let i = 0; i < result.length; i++) {
    const b = result[i];
    if (!b || typeof b !== 'object') {
      throw new Error(`élément #${i} du tableau retourné n'est pas un objet bloc {x, y, z, block}`);
    }
    const { x, y, z, block } = b;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
      throw new Error(`bloc #${i} : coordonnées non entières (x=${x}, y=${y}, z=${z}) — toutes les coordonnées doivent être des entiers`);
    }
    if (typeof block !== 'string' || block.length === 0) {
      throw new Error(`bloc #${i} (${x},${y},${z}) : champ block manquant ou vide`);
    }
    blocks[i] = { x, y, z, block };
  }
  return blocks;
}
```

Dans `runStructureCode`, remplacer tout le bloc :
```js
  let blocks;
  try {
    blocks = JSON.parse(JSON.stringify(result));
  } catch {
    throw new Error('generateStructure() a retourné une structure non sérialisable');
  }
  return normalizeOrigin(blocks);
```
par :
```js
  return normalizeOrigin(sanitizeBlocks(result));
```

## 3. Simplifier normalizeOrigin (les blocs sont désormais garantis valides)

Fichier : `src/generator.js`.

Remplacer le corps de `normalizeOrigin` par :
```js
function normalizeOrigin(blocks) {
  if (blocks.length === 0) return blocks;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  for (const b of blocks) {
    if (b.x < min.x) min.x = b.x;
    if (b.y < min.y) min.y = b.y;
    if (b.z < min.z) min.z = b.z;
  }
  for (const axis of ['x', 'y', 'z']) {
    if (min[axis] < 0) {
      for (const b of blocks) b[axis] -= min[axis];
    }
  }
  return blocks;
}
```

## 4. Dédoublonnage des coordonnées (dernier bloc posé gagne)

Fichier : `src/generator.js`.

Ajouter :
```js
// Les primitives se chevauchent (murs + toit + cloisons) : on garde le
// dernier bloc posé à chaque coordonnée, comme le ferait le jeu
function dedupeBlocks(blocks) {
  const map = new Map();
  for (const b of blocks) map.set(`${b.x},${b.y},${b.z}`, b);
  return [...map.values()];
}
```

Dans la boucle de tentatives de `generateStructure()`, remplacer :
```js
const blocks = completeDoors(runStructureCode(code, timeoutMs, sandbox));
```
par :
```js
const blocks = completeDoors(dedupeBlocks(runStructureCode(code, timeoutMs, sandbox)));
```

Exporter `dedupeBlocks` dans `module.exports` (utile pour les tests).

## 5. Budget spatial vérifié après exécution + constantes partagées avec le prompt

Fichier : `src/generator.js`.

a) Ajouter en haut du fichier (avant les prompts) :
```js
// Budgets spatiaux (source unique : utilisée dans les prompts ET la vérification)
const BUDGET_PRIMITIVES = { x: 96, y: 320, z: 96 };
const BUDGET_LIBRE = { x: 96, y: 64, z: 96 };
```

b) Dans `PRIMITIVES_PROMPT` (template literal), remplacer les valeurs en dur « budget spatial 96 en X et Z, 320 en Y » par les interpolations `${BUDGET_PRIMITIVES.x}` / `${BUDGET_PRIMITIVES.y}`. Dans `SYSTEM_PROMPT`, remplacer « 96 (x) × 64 (y) × 96 (z) » par `${BUDGET_LIBRE.x} (x) × ${BUDGET_LIBRE.y} (y) × ${BUDGET_LIBRE.z} (z)`. Attention : `SYSTEM_PROMPT` doit alors être déclaré APRÈS les constantes.

c) Dans la boucle de tentatives de `generateStructure()`, juste après l'obtention de `blocks` (point 4), ajouter la vérification (dans le `try`, pour que l'erreur soit réinjectée au LLM) :
```js
const budget = usingPrimitives ? BUDGET_PRIMITIVES : BUDGET_LIBRE;
const dims = { x: 0, y: 0, z: 0 };
for (const b of blocks) {
  if (b.x >= dims.x) dims.x = b.x + 1;
  if (b.y >= dims.y) dims.y = b.y + 1;
  if (b.z >= dims.z) dims.z = b.z + 1;
}
if (dims.x > budget.x || dims.y > budget.y || dims.z > budget.z) {
  throw new Error(`structure hors budget spatial : ${dims.x}×${dims.y}×${dims.z} pour un maximum de ${budget.x}×${budget.y}×${budget.z} — réduis TOUTES les dimensions à l'échelle en conservant les proportions`);
}
```
Note : les blocs sortent de `normalizeOrigin`, donc le coin minimum est >= 0 ; `max + 1` suffit pour mesurer l'emprise.

## 6. schemRefsFor : plus de refs hors-style

Fichier : `src/generator.js`, fonction `schemRefsFor`.

Remplacer :
```js
const chosen = priority.length > 0 ? priority.slice(0, 3) : SCHEM_REFS.slice(0, 3);
```
par :
```js
// Aucune ref du bon style : ne rien injecter plutôt que de biaiser la palette
const chosen = priority.slice(0, 3);
```
Supprimer le commentaire devenu obsolète juste au-dessus si nécessaire, et garder le `if (chosen.length === 0) return '';` existant.

## 7. Tronquer le code des cas mémoire

Fichier : `src/generator.js`, fonction `formatMemoryCases`.

Remplacer l'interpolation `${c.code}` par :
```js
${c.code.length > 4000 ? c.code.slice(0, 4000) + '\n// [... code tronqué ...]' : c.code}
```
(adapter proprement dans le template literal existant).

## 8. Incohérences de texte dans PRIMITIVES_PROMPT

Fichier : `src/generator.js`.

a) Remplacer « Le sandbox n'expose QUE : les 8 primitives ci-dessous + Math. » par « Le sandbox n'expose QUE les primitives listées ci-dessous + Math. »

b) Dans les 3 exemples (Exemple 1, 2, 3), déplacer le commentaire `// FIN_STRUCTURE` APRÈS l'accolade fermante de `generateStructure()`, pour être cohérent avec le format demandé en tête de prompt. Exemple :
```js
  return [...b1, ...p, ...w1, ...w2, ...t];
}
// FIN_STRUCTURE
```

## 9. Sortir systemBlocks de la boucle de tentatives

Fichier : `src/generator.js`, `generateStructure()`.

Les trois lignes qui construisent `memoryCases`, `memoryCasesText` et `systemBlocks` sont invariantes : les déplacer juste AVANT le `for (let attempt = 1; ...)`.

## 10. Modèle configurable

Fichier : `src/generator.js`.

Remplacer :
```js
const MODEL = 'claude-sonnet-4-6';
```
par :
```js
const MODEL = process.env.GENERATOR_MODEL || 'claude-sonnet-4-6';
```

## 11. withRetry : ne pas retenter les erreurs non récupérables

Fichier : `src/llm.js`, fonction `withRetry`.

Dans le `catch`, avant de programmer le retry, ajouter :
```js
const status = err.status ?? err.response?.status;
// 4xx (sauf 408/429) = erreur définitive : retenter ne sert à rien
if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
  throw err;
}
```

## 12. Logger le code aussi en cas d'échec de tentative

Fichier : `src/generator.js`, dans le `catch` de la boucle de tentatives.

Après le `console.warn` existant, ajouter :
```js
console.warn('[generator] code fautif :\n', code);
```

---

## Optionnel (ne pas faire sans validation de Pierre)

## 13. Durcissement sandbox

Le contexte null-prototype bloque `this.constructor.constructor`, mais les tableaux retournés par les primitives (fonctions hôtes) appartiennent au realm hôte : `boite({...}).constructor.constructor('return process')()` reste possible depuis le code exécuté. Risque faible (code produit par notre propre LLM). Si on veut le fermer : ne plus exposer les primitives dans la VM ; faire retourner au code un plan d'appels (nom + arguments) et exécuter les primitives côté hôte après validation. C'est un refactor du contrat de prompt, à traiter à part.

## 14. Extraire les prompts

Déplacer `PRIMITIVES_PROMPT` et `SYSTEM_PROMPT` dans `prompts/generator-primitives.md` et `prompts/generator-libre.md`, chargés au démarrage. Attention au point 5b (interpolation des budgets) : prévoir un mini-templating (`{{BUDGET_X}}`...) si extraction.

---

## Vérification finale

1. `node -e "require('./src/generator.js')"` doit charger sans erreur.
2. S'il existe des tests (`npm test` ou fichiers test/), les lancer. Note : `runStructureCode` ne passe plus par JSON, si un test utilisait `deepStrictEqual` sur la sortie il doit continuer à passer (les objets sont désormais des objets hôtes propres).
3. Test rapide de non-régression :
```js
const { runStructureCode } = require('./src/generator');
const code = 'function generateStructure(){ return [{x:-2,y:0,z:0,block:"stone"},{x:0,y:0,z:0,block:"stone"},{x:0,y:0,z:0,block:"dirt"}]; }';
console.log(runStructureCode(code, 1000, {}));
// attendu : origine translatée à x=0, et après dedupeBlocks (si testé via generateStructure) un seul bloc en (2,0,0) : "dirt"
```
4. Vérifier qu'un code retournant `[{x:1.5,y:0,z:0,block:"stone"}]` lève bien une erreur explicite.

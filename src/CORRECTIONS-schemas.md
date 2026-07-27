# Plan de correction : src/schemas.js

Contexte : audit du 27/07/2026 (fichier 7/13). Point 1 : crash latent. Point 2 : suppression de code mort (avec vérification préalable). Point 3 : robustesse. Annexe : option non validée.

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. loadSchema : Math.min en spread explose sur les gros schémas

Problème : `Math.min(...blocks.map((b) => b.y))` passe chaque bloc en argument de fonction ; au-delà de ~100 000 éléments (château exporté avec terrain), RangeError « Maximum call stack size exceeded ».

Remplacer :
```js
const minY = Math.min(...blocks.map((b) => b.y));
```
par :
```js
let minY = Infinity;
for (const b of blocks) if (b.y < minY) minY = b.y;
```

## 2. Supprimer chooseSchema (code mort à la logique incohérente)

Problème : `chooseSchema` (singulier) est l'ancienne sélection remplacée par le mode RAG `chooseSchemas`. Sa priorité 2 (`if (match && catalog.some((e) => e.style === style)) return match;`) ne correspond pas à son commentaire « type exact, peu importe le style » : elle conditionne le retour à la présence du style demandé N'IMPORTE OÙ dans le catalogue.

AVANT toute suppression, vérifier qu'elle est bien inutilisée :
```
grep -rn "chooseSchema\b" src/ --include="*.js"
```
(le `\b` évite de matcher chooseSchemas). Si seuls schemas.js (définition + export) apparaissent :
- supprimer la fonction `chooseSchema` entière et son commentaire « STRICT : on ne propose que si... » ;
- la retirer de `module.exports` ;
- au passage, remonter `typeKeywords` et `matchType` (dupliqués dans chooseSchemas) au niveau module :
```js
const TYPE_KEYWORDS = {
  villa: ['villa'],
  maison: ['maison', 'chaumiere', 'cottage', 'chalet'],
  manoir: ['manoir', 'demeure', 'ferme', 'batisse'],
  chateau: ['chateau', 'castle', 'castillo', 'forteresse', 'palais'],
  tour: ['tour', 'phare', 'donjon']
};
function matchesType(schemaType, type) {
  if (schemaType === type) return true;
  const kws = TYPE_KEYWORDS[schemaType] || [schemaType];
  return kws.some((kw) => type.includes(kw));
}
```
et adapter `chooseSchemas` pour les utiliser (`matchesType(e.type_batiment, type)`).

Si le grep révèle un usage réel ailleurs : NE PAS supprimer, me le signaler dans le rapport et laisser tel quel.

## 3. analyzeSchema : charger schem-refs.json de façon gardée

Problème : `require('../data/schem-refs.json')` dans `analyzeSchema` lève MODULE_NOT_FOUND si le fichier est absent : tous les analyzeSchema échouent alors que partout ailleurs le chargement de data/*.json est protégé par try/catch avec repli.

En tête de module (près de `loadValid`), ajouter :
```js
let SCHEM_REFS = null;
function loadSchemRefs() {
  if (SCHEM_REFS) return SCHEM_REFS;
  try { SCHEM_REFS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schem-refs.json'), 'utf8')); }
  catch { SCHEM_REFS = []; }
  return SCHEM_REFS;
}
```
Et dans `analyzeSchema`, remplacer :
```js
const refInfo = require('../data/schem-refs.json').find((r) => r.nom === entry.nom) || {};
```
par :
```js
const refInfo = loadSchemRefs().find((r) => r.nom === entry.nom) || {};
```

---

## Annexe : option NON validée (à décider plus tard)

- Cache de `loadSchema` par nom : les .schem sont statiques mais relus + gunzip + décodés NBT + parcourus à chaque appel. Un `Map` module-level `nom → résultat` accélérerait !schema quand les mêmes références reviennent. Attention à la mémoire (les gros schémas gardés en RAM) : si implémenté, plafonner à ~5 entrées (éviction du plus ancien).

---

## Vérification finale

1. `node -e "require('./src/schemas.js')"` charge sans erreur.
2. `grep -rn "chooseSchema\b" src/` ne retourne plus rien après suppression.
3. Test de non-régression chooseSchemas (sans serveur) :
```js
const { chooseSchemas } = require('./src/schemas');
chooseSchemas({ type_batiment: 'maison_bretonne_en_pierre', style: 'rustique' }).then(console.log);
// attendu : mêmes résultats qu'avant refactor (les entrées rustique du catalogue, triées)
```
4. Test du point 1 : vérifier qu'un gros tableau ne crashe plus :
```js
// simulation : la logique minY doit tenir 500k éléments
const blocks = Array.from({ length: 500000 }, (_, i) => ({ y: i % 50 }));
let minY = Infinity; for (const b of blocks) if (b.y < minY) minY = b.y;
console.log(minY); // 0, sans RangeError
```
5. Renommer temporairement data/schem-refs.json puis appeler analyzeSchema sur une entrée du catalogue : doit retourner un résultat avec `ratios: { stairs: 0, glass: 0, torches: 0 }` au lieu de crasher. Restaurer le fichier ensuite.

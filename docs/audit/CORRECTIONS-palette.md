# Plan de correction : src/palette.js + src/blockcolors.js

Contexte : audit du 27/07/2026 (fichier 12/13). Nettoyage de code mort (palette.js) et message d'erreur explicite (blockcolors.js). Aucun changement de comportement du pipeline.

---

## 1. palette.js : supprimer assignBlocks (dépréciée et morte)

AVANT suppression, vérifier :
```
grep -rn "assignBlocks" src/ --include="*.js"
```
Attendu : uniquement palette.js (définition + export). Si un usage réel apparaît ailleurs : NE Pas supprimer, le signaler.

Puis :
- supprimer la fonction `assignBlocks` entière (avec son commentaire @deprecated) ;
- supprimer la constante `const MODEL = 'claude-sonnet-4-6';` (elle ne servait qu'à assignBlocks ; MODEL_THEMES reste) ;
- retirer `assignBlocks` de `module.exports` ;
- si `nearestBlock` ou `stripCodeFences` ne sont plus utilisés après suppression, vérifier avant de toucher aux imports : `nearestBlock` reste utilisé (fallback d'assignThemes, buildThemePicker) et `stripCodeFences` reste utilisé (assignThemes). Ne pas retirer ces imports.

## 2. palette.js : supprimer buildPaletteMap si morte

Vérifier :
```
grep -rn "buildPaletteMap" src/ --include="*.js"
```
Attendu : uniquement palette.js. Les voxeliseurs reçoivent une FONCTION picker (buildThemePicker), pas cette Map. Si confirmé mort : supprimer la fonction et son export. Sinon, laisser tel quel et le signaler.

## 3. blockcolors.js : message d'erreur explicite au chargement

Ce fichier est VITAL (pas de repli possible) : échouer vite est correct, mais avec un message actionnable.

Remplacer :
```js
function loadBlockColors() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/block_colors.json'), 'utf8'));
  return new Map(Object.entries(raw));
}
```
par :
```js
function loadBlockColors() {
  const p = path.join(__dirname, '../data/block_colors.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`data/block_colors.json manquant ou invalide (${err.message}) — ce fichier est requis pour le mapping couleur→bloc, restaure-le depuis le dépôt ou régénère-le`);
  }
  return new Map(Object.entries(raw));
}
```
(Adapter la fin du message si un script de génération existe dans le projet : le nommer.)

---

## Note transverse (rien à faire ici)

`MODEL_THEMES` (palette.js), `MODEL_SETS` (decorator.js), `MODEL` (generator.js), `MODEL_ANALYSE`/`MODEL_CRITIQUE` (vision.js) : 5 identifiants de modèles en dur dans 4 fichiers. Une centralisation (section `models` de config.json) sera proposée dans la synthèse finale de l'audit : ne PAS l'improviser ici.

---

## Vérification finale

1. `node -e "require('./src/palette.js'); require('./src/blockcolors.js')"` charge sans erreur.
2. `grep -rn "assignBlocks\|buildPaletteMap" src/` ne retourne plus rien (si les deux suppressions ont été confirmées).
3. Test rapide du pipeline palette (sans API) :
```js
const { clusterColors, buildThemePicker, themeOfBlock } = require('./src/palette');
const { loadBlockColors, filterColors, NATURAL_BLOCKS } = require('./src/blockcolors');
const colors = filterColors(loadBlockColors(), NATURAL_BLOCKS);
const centroids = clusterColors([[34, 139, 34], [128, 128, 128], [194, 178, 128]], 3);
const pick = buildThemePicker(centroids, ['vegetation', 'roche', 'sable'], colors);
console.log(pick(30, 140, 30), pick(120, 120, 120), pick(200, 180, 130));
// attendu : un bloc végétation, un bloc roche, un bloc sable
```
4. Renommer temporairement data/block_colors.json et vérifier que le message d'erreur au boot est le nouveau message explicite. Restaurer.

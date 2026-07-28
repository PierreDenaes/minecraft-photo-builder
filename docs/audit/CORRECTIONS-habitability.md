# Plan de correction : src/habitability.js (+ retombées index.js)

Contexte : audit du 27/07/2026 (fichier 8/13). Décision de Pierre : version « propre » : les défauts deviennent des objets structurés `{ code, message }` et auditChecks classe par code (plus de regex sur le texte français des messages). Le point 3 supprime la copie locale d'isMonument dans index.js.

ATTENTION : ce refactor touche le CONTRAT de retour d'auditHabitability. Tous les consommateurs doivent être adaptés dans la même passe (point 2). Ne rien laisser à moitié migré.

---

## 1. auditHabitability : retourner des objets { code, message }

Codes définis (exactement ceux-ci) :
- `hauteur` : hauteur libre médiane insuffisante
- `entree` : aucune entrée praticable
- `escalier` : niveaux non reliés
- `facade` : façade trop uniforme
- `eau` : eau non contenue
- `fenetres` : fenêtres promises par la vision absentes
- `alignement` : fenêtres désalignées entre niveaux

Transformer chaque `defects.push('...')` en objet. Liste exhaustive des remplacements :

```js
defects.push({ code: 'hauteur', message: `plancher y=${fy} : hauteur libre médiane ${median} bloc(s) sous le plafond — vise au moins 4` });

defects.push({ code: 'entree', message: 'aucune entrée praticable (ouverture 1x2 sous linteau) au rez-de-chaussée — perce une porte' });

defects.push({ code: 'escalier', message: `aucun escalier ni échelle entre les niveaux y=${f1} et y=${f2} — relie-les (trémie dans le plancher + escaliers alignés)` });

defects.push({ code: 'facade', message: `façade ${name} : ${mats.size} matériau(x) seulement — varie (3 à 5, stairs/slabs/walls de la palette compris)` });

defects.push({ code: 'eau', message: `eau non contenue : ${eauLibre.length} bloc(s) d'eau sans fond — creuse un bassin étanche (fond + parois)` });

defects.push({ code: 'fenetres', message: `la photo montre des baies vitrées mais les murs n'ont que ${vitresMur} vitre(s) — perce de vraies fenêtres en glass_pane encadrées sur les façades` });

defects.push({ code: 'alignement', message: `fenêtres désalignées sur la façade ${name} entre les niveaux y=${f1} et y=${f2} — aligne les colonnes de baies` });
```

Au passage (point mineur validé) : dans le check 3, élargir la détection d'escalier pour inclure la marche sommitale posée à y=f2 par la primitive escalier. Remplacer :
```js
const linked = blocks.some((b) => STAIR_OR_LADDER.test(b.block) && b.y > f1 && b.y < f2);
```
par :
```js
const linked = blocks.some((b) => STAIR_OR_LADDER.test(b.block) && b.y > f1 && b.y <= f2);
```

## 2. auditChecks : classement par code (et correction de la fuite « alignement »)

Remplacer le corps d'auditChecks :
```js
function auditChecks(blocks, description = {}) {
  const defects = auditHabitability(blocks, description);
  const codes = new Set(defects.map((d) => d.code));
  return [
    { name: 'Hauteur sous plafond', passed: !codes.has('hauteur') },
    { name: 'Portes & accès', passed: !codes.has('entree') },
    { name: 'Escaliers praticables', passed: !codes.has('escalier') },
    // alignement rejoint la cohérence des murs (défaut esthétique de façade)
    { name: 'Murs cohérents', passed: !codes.has('facade') && !codes.has('alignement') },
    // habitabilité de fond : fenêtres manquantes, eau non contenue
    { name: 'Bâtiment habitable', passed: !codes.has('fenetres') && !codes.has('eau') }
  ];
}
```
(Supprimer le commentaire sur la regex ancrée, devenu obsolète.)
Changement de comportement VOULU : « fenêtres désalignées » ne fait plus échouer « Bâtiment habitable » mais « Murs cohérents ».

## 3. Adapter TOUS les consommateurs (index.js)

Chercher les usages :
```
grep -n "auditHabitability" src/*.js
```
Attendu : index.js (2 à 4 occurrences selon que la factorisation de CORRECTIONS-index.md point 4 a été appliquée) + habitability.js lui-même.

Dans index.js, chaque usage du tableau de défauts joint en texte doit passer par `.message` :
- Boucle(s) de correction :
```js
const defauts = isMonument(description) ? [] : auditHabitability(blocks, description);
const defautsText = defauts.length > 0
  ? `Défauts structurels MESURÉS (tour ${round}) — corrige-les impérativement :\n- ${defauts.map((d) => d.message).join('\n- ')}`
  : '';
```
- Défauts restants après checks :
```js
const restants = auditHabitability(blocks, description);
if (restants.length > 0) bot.chat(`⚠ Défauts restants : ${restants.map((d) => d.message).join(' ; ')}`.slice(0, 250));
```
Si la fonction factorisée `corrigerEtFinaliser` existe (CORRECTIONS-index.md appliqué), il n'y a que 2 endroits à adapter dedans. Sinon, adapter les 2 blocs dupliqués d'onPhoto ET d'onSchema (4 endroits).

## 4. index.js : importer isMonument au lieu de le dupliquer

Problème : `MONUMENT_KEYWORDS` + `isMonument` existent en double (habitability.js les exporte, index.js a une copie locale) : les deux regex divergeront à la première évolution.

Dans index.js :
- supprimer la définition locale de `MONUMENT_KEYWORDS` et de `function isMonument(...)` (lignes ~41-48) ;
- compléter l'import existant :
```js
const { auditHabitability, auditChecks, isMonument } = require('./habitability');
```
Vérifier qu'aucun autre fichier ne redéfinit isMonument (`grep -n "MONUMENT_KEYWORDS\|function isMonument" src/*.js` : seul habitability.js doit rester).

---

## Vérification finale

1. `node -e "require('./src/habitability.js')"` charge sans erreur.
2. Test rapide sans serveur :
```js
const { auditHabitability, auditChecks } = require('./src/habitability');
// structure minimale volontairement défectueuse : un cube plein sans porte
const blocks = [];
for (let x = 0; x < 10; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 10; z++) {
  if (x === 0 || x === 9 || z === 0 || z === 9 || y === 0 || y === 5) blocks.push({ x, y, z, block: 'stone_bricks' });
}
const defects = auditHabitability(blocks, { type_batiment: 'maison' });
console.log(defects); // chaque élément a { code, message }, dont un code 'entree'
console.log(auditChecks(blocks, { type_batiment: 'maison' })); // 'Portes & accès' passed:false
```
3. Vérifier que TOUS les codes possibles apparaissent dans le mapping d'auditChecks (aucun code orphelin) : grep `code: '` dans habitability.js et comparer à la liste du point 2.
4. Test monument : `auditHabitability(blocks, { type_batiment: 'arc_de_triomphe' })` retourne `[]`.
5. Test manuel !photo : la ligne « Vérifications : ... » du chat s'affiche comme avant, et les défauts injectés en correction restent des phrases lisibles (pas de `[object Object]` — c'est LE symptôme d'un consommateur non migré).

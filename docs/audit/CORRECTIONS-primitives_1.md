# Plan de correction : src/primitives.js

Contexte : audit du 27/07/2026 (fichier 3/13). Les points 1 à 3 sont des bugs, 4 est une mise en cohérence avec le prompt du générateur, 5 et 6 sont des optimisations. L'annexe liste des options non validées.

Règle générale : ne change aucun comportement fonctionnel non listé ici. Chaque primitive retourne un tableau [{x, y, z, block}] : conserver ce contrat.

---

## 1. toitPlat : acrotère en bloc inexistant pour les planches

Problème : la dérivation du muret transforme `X_planks` en `X_wall` (ex : `oak_planks` → `oak_wall`), bloc qui n'existe pas. Le check « blocs inexistants » du générateur rejette alors le code et brûle une tentative de génération.

Dans `toitPlat`, remplacer :
```js
const wall = /_bricks$|_planks$/.test(materiau)
  ? materiau.replace(/_planks$|_bricks$/, (m) => m === '_planks' ? '_wall' : '_brick_wall')
  : 'cobblestone_wall';
```
par :
```js
// planks → fence de la même essence (les planks n'ont PAS de variante wall) ;
// bricks → brick_wall ; sinon repli cobblestone_wall
const wall = /_planks$/.test(materiau)
  ? materiau.replace(/_planks$/, '_fence')
  : /_bricks$/.test(materiau)
    ? materiau.replace(/_bricks$/, '_brick_wall')
    : 'cobblestone_wall';
```

## 2. arche : orientation des stairs de voûte fausse quand axe='x'

Problème : la frange de la voûte pose `facing=east/west` selon le signe de `ds`, mais quand le tunnel traverse selon x, `ds` est une distance en Z : les facings corrects sont `south/north`. Résultat actuel : stairs tournés à 90° pour les arches orientées est-ouest.

Dans `arche`, remplacer :
```js
let facing;
if (ds < 0) facing = 'east';
else if (ds > 0) facing = 'west';
else facing = axe === 'x' ? 'north' : 'east'; // clef de voûte : orientation arbitraire cohérente
```
par :
```js
// ds est mesuré sur l'axe de SECTION (z quand axe='x', x quand axe='z') :
// le facing doit suivre ce même axe
let facing;
if (axe === 'x') {
  if (ds < 0) facing = 'south';
  else if (ds > 0) facing = 'north';
  else facing = 'north'; // clef de voûte : orientation arbitraire cohérente
} else {
  if (ds < 0) facing = 'east';
  else if (ds > 0) facing = 'west';
  else facing = 'east';
}
```

## 3. lierre : vignes sans état d'accrochage (elles disparaissent en jeu)

Problème : `block: 'vine'` sans propriété d'attachement : une vine dont aucune face n'est true est retirée par le jeu à la première mise à jour de bloc voisine.

Dans `lierre`, remplacer :
```js
out.push({ x: cx - dx, y, z: cz - dz, block: 'vine' });
```
par :
```js
// face d'accrochage = direction du mur porteur vu depuis la vine,
// qui est exactement OPPOSITE[facade] (nord → south, est → west...)
out.push({ x: cx - dx, y, z: cz - dz, block: `vine[${OPPOSITE[facade]}=true]` });
```

## 4. porte : dériver l'essence de la porte du materiau

Problème : la porte est toujours `oak_door`, quel que soit `materiau` (utilisé seulement pour tympan/linteau), alors que le prompt du générateur promet des portes assorties au bois choisi (spruce_log → porte spruce).

Ajouter près de `WOOD_PREFIX` (ATTENTION : `WOOD_PREFIX` est déclaré plus bas dans le fichier que `porte` ; les `const` ne sont pas hoistées, donc déplacer la déclaration de `WOOD_PREFIX` AVANT `porte`, ou placer ce helper après `WOOD_PREFIX` : les appels à l'exécution fonctionneront dans les deux cas, seule l'initialisation du module impose l'ordre) :
```js
// Essence de porte déduite du materiau : préfixe bois le plus LONG d'abord
// (dark_oak avant oak, sinon dark_oak_log matcherait oak). Repli : oak.
const WOOD_BY_LENGTH = [...WOOD_PREFIX].sort((a, b) => b.length - a.length);
function doorWoodFor(materiau) {
  if (typeof materiau === 'string') {
    for (const w of WOOD_BY_LENGTH) {
      if (materiau === w || materiau.startsWith(`${w}_`)) return w;
    }
  }
  return 'oak';
}
```

Dans `porte`, remplacer les deux lignes :
```js
out.push({ x: span.x, y: y0 + 1, z: span.z, block: `oak_door[facing=${facing},half=lower,hinge=${span.hinge}]` });
out.push({ x: span.x, y: y0 + 2, z: span.z, block: `oak_door[facing=${facing},half=upper,hinge=${span.hinge}]` });
```
par :
```js
const door = `${doorWoodFor(materiau)}_door`;
out.push({ x: span.x, y: y0 + 1, z: span.z, block: `${door}[facing=${facing},half=lower,hinge=${span.hinge}]` });
out.push({ x: span.x, y: y0 + 2, z: span.z, block: `${door}[facing=${facing},half=upper,hinge=${span.hinge}]` });
```
(sortir le calcul de `door` de la boucle `for (const span of spans)`).

Note : toutes les essences de `WOOD_PREFIX` ont une porte en 1.20 (y compris mangrove, cherry, crimson, warped). Vérifier que le check `alwaysOk` du générateur (src/generator.js) tolère ces portes : il liste `oak_door` en dur. Ajouter dans `alwaysOk` les autres portes bois OU remplacer le test par une tolérance `/_door$/` sur le nom de base.

## 5. toitDeuxPans : remplissage des pignons en O(n²)

Problème : `out.some((b) => ...)` appelé dans des boucles imbriquées rescanne tout le tableau à chaque cellule.

Au début de `toitDeuxPans` (après `const out = [];`), ajouter :
```js
const occ = new Set();
const push = (b) => { occ.add(`${b.x},${b.y},${b.z}`); out.push(b); };
const has = (x, y, z) => occ.has(`${x},${y},${z}`);
```
Puis dans les DEUX branches (faitage 'x' et 'z') :
- remplacer chaque `out.push(...)` par `push(...)` ;
- remplacer chaque test `!out.some((b) => b.x === X && b.y === Y && b.z === Z)` par `!has(X, Y, Z)`.

## 6. tour : créneaux, récupération du dernier merlon en O(n)

Problème : `[...placed].pop()` copie tout le Set à chaque itération.

Dans `tour` (bloc `if (creneaux)`), tenir une variable au lieu de recopier le Set :
```js
let lastKey = null;
// ...dans la boucle :
if (lastKey) {
  const [lx, lz] = lastKey.split(',').map(Number);
  if (Math.abs(c.dx - lx) + Math.abs(c.dz - lz) === 1) continue;
}
placed.add(key);
lastKey = key;
```
(supprimer le bloc `if (placed.size > 0) { const last = [...placed].pop(); ... }`).

---

## Annexe : options NON validées (à décider plus tard)

- Acrotère de toitPlat pour les bétons : actuellement `cobblestone_wall` en repli (villa moderne grise avec muret de moellons). Option : utiliser la slab du même matériau via la table `SLAB_NAME` quand elle existe.
- `checkPositiveBox` ne vérifie pas que les coordonnées sont entières. La validation `sanitizeBlocks` ajoutée dans generator.js (CORRECTIONS-generator.md point 2) attrape le cas en aval : redondant ici, sauf si on veut un message d'erreur nommant la primitive fautive.

---

## Vérification finale

1. `node -e "const p = require('./src/primitives'); console.log(Object.keys(p).length)"` charge sans erreur.
2. toitPlat : `toitPlat({x1:0,z1:0,x2:5,z2:5,y:4,materiau:'oak_planks'})` ne contient plus aucun bloc `oak_wall` mais des `oak_fence`.
3. arche axe='x' : `arche({x1:0,z1:0,x2:10,z2:6,y_base:0,y_faitage:10,materiau:'stone_brick',axe:'x'})` : les stairs de voûte portent `facing=south` ou `facing=north` (jamais east/west, sauf aucun : vérifier).
4. lierre : tous les blocs retournés matchent `/^vine\[(north|south|east|west)=true\]$/`.
5. porte : `porte({facade:'sud',x:3,z:0,y0:0,materiau:'spruce_log'})` produit des `spruce_door[...]` ; avec `materiau:'dark_oak_log'` des `dark_oak_door[...]` (PAS oak_door) ; avec `materiau:'stone_bricks'` des `oak_door[...]` (repli).
6. toitDeuxPans : comparer la sortie avant/après le point 5 sur un même appel (`JSON.stringify` triés) : ensembles de blocs identiques.
